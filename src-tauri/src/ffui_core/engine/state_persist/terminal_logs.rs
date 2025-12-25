use std::fs;
use std::path::PathBuf;
#[cfg(test)]
use std::sync::Mutex;
#[cfg(test)]
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};

#[cfg(test)]
use super::AtomicU64;
use crate::ffui_core::domain::{JobRun, JobStatus, QueueStateLite, TranscodeJob};
use crate::ffui_core::settings::types::{CrashRecoveryLogRetention, QueuePersistenceMode};
#[cfg(test)]
use crate::sync_ext::MutexExt;

#[cfg(test)]
static QUEUE_LOGS_DIR_OVERRIDE: once_cell::sync::Lazy<Mutex<Option<PathBuf>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[cfg(test)]
pub(in crate::ffui_core::engine) struct QueueLogsDirGuard;

#[cfg(test)]
impl Drop for QueueLogsDirGuard {
    fn drop(&mut self) {
        let mut override_dir = QUEUE_LOGS_DIR_OVERRIDE.lock_unpoisoned();
        *override_dir = None;
    }
}

#[cfg(test)]
pub(in crate::ffui_core::engine) fn override_queue_logs_dir_for_tests(
    dir: PathBuf,
) -> QueueLogsDirGuard {
    let mut override_dir = QUEUE_LOGS_DIR_OVERRIDE.lock_unpoisoned();
    *override_dir = Some(dir);
    QueueLogsDirGuard
}

fn queue_logs_dir() -> Option<PathBuf> {
    #[cfg(test)]
    {
        let override_dir = QUEUE_LOGS_DIR_OVERRIDE.lock_unpoisoned();
        if let Some(dir) = override_dir.as_ref() {
            return Some(dir.clone());
        }
    }

    crate::ffui_core::queue_logs_dir().ok()
}

pub(in crate::ffui_core::engine) fn queue_job_log_path(job_id: &str) -> Option<PathBuf> {
    let dir = queue_logs_dir()?;
    Some(dir.join(format!("{job_id}.log")))
}

fn default_log_retention() -> CrashRecoveryLogRetention {
    CrashRecoveryLogRetention::default()
}

fn effective_log_retention(
    settings_retention: Option<CrashRecoveryLogRetention>,
) -> CrashRecoveryLogRetention {
    let defaults = default_log_retention();
    let retention = settings_retention.unwrap_or(defaults);
    CrashRecoveryLogRetention {
        max_files: retention.max_files.or(defaults.max_files),
        max_total_mb: retention.max_total_mb.or(defaults.max_total_mb),
    }
}

pub(in crate::ffui_core::engine) const fn is_terminal_status(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

#[cfg(test)]
pub(in crate::ffui_core::engine) static TERMINAL_LOG_WRITE_COUNT: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedTerminalJobRunHistory {
    version: u8,
    runs: Vec<JobRun>,
}

fn persist_terminal_job_run_history(job_id: &str, runs: &[JobRun]) {
    let Some(path) = queue_job_log_path(job_id) else {
        return;
    };
    let Some(dir) = path.parent() else {
        return;
    };
    if let Err(err) = fs::create_dir_all(dir) {
        crate::debug_eprintln!(
            "failed to create queue logs directory {}: {err:#}",
            dir.display()
        );
        return;
    }

    let tmp_path = path.with_extension("tmp");
    match fs::File::create(&tmp_path) {
        Ok(mut file) => {
            let payload = PersistedTerminalJobRunHistory {
                version: 1,
                runs: runs.to_vec(),
            };
            if let Err(err) = serde_json::to_writer(&mut file, &payload) {
                crate::debug_eprintln!(
                    "failed to write terminal job run history {}: {err:#}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = fs::rename(&tmp_path, &path) {
                crate::debug_eprintln!(
                    "failed to atomically rename {} -> {}: {err:#}",
                    tmp_path.display(),
                    path.display()
                );
                let _ = fs::remove_file(&tmp_path);
            } else {
                #[cfg(test)]
                TERMINAL_LOG_WRITE_COUNT.fetch_add(1, Ordering::SeqCst);
            }
        }
        Err(err) => {
            crate::debug_eprintln!(
                "failed to create temp terminal job log file {}: {err:#}",
                tmp_path.display()
            );
        }
    }
}

fn enforce_terminal_log_retention(retention: CrashRecoveryLogRetention) {
    let Some(dir) = queue_logs_dir() else {
        return;
    };
    if !dir.exists() {
        return;
    }

    let max_files = retention.max_files.unwrap_or(0) as usize;
    let max_total_bytes = u64::from(retention.max_total_mb.unwrap_or(0))
        .saturating_mul(1024)
        .saturating_mul(1024);

    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total_bytes: u64 = 0;

    let read_dir = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(err) => {
            crate::debug_eprintln!(
                "failed to read queue logs directory {}: {err:#}",
                dir.display()
            );
            return;
        }
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let len = meta.len();
        total_bytes = total_bytes.saturating_add(len);
        entries.push((path, len, modified));
    }

    // Sort newest first; delete oldest first.
    entries.sort_by(|a, b| b.2.cmp(&a.2));

    let mut keep = entries;
    let mut deleted_any = false;

    while (max_files > 0 && keep.len() > max_files)
        || (max_total_bytes > 0 && total_bytes > max_total_bytes)
    {
        let Some((path, len, _)) = keep.pop() else {
            break;
        };
        if fs::remove_file(&path).is_ok() {
            total_bytes = total_bytes.saturating_sub(len);
            deleted_any = true;
        }
    }

    if deleted_any {
        // Best-effort cleanup: remove the directory if it is now empty.
        let _ = fs::remove_dir(&dir);
    }
}

pub(in crate::ffui_core::engine) fn load_persisted_terminal_job_logs(
    job_ids: &[String],
    retention: CrashRecoveryLogRetention,
) -> Vec<(String, Vec<JobRun>)> {
    // Apply retention before reading so we don't load logs that are about to be deleted.
    enforce_terminal_log_retention(retention);

    let mut results = Vec::new();
    for job_id in job_ids {
        let Some(path) = queue_job_log_path(job_id) else {
            continue;
        };
        let Ok(data) = fs::read_to_string(&path) else {
            continue;
        };

        if let Ok(payload) = serde_json::from_str::<PersistedTerminalJobRunHistory>(&data)
            && !payload.runs.is_empty()
        {
            results.push((job_id.clone(), payload.runs));
            continue;
        }

        // Backward-compatibility: older versions stored a plain newline-delimited
        // log file. Load it as a single run with an unknown command.
        let lines = data
            .lines()
            .map(std::string::ToString::to_string)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            results.push((
                job_id.clone(),
                vec![JobRun {
                    command: String::new(),
                    logs: lines,
                    started_at_ms: None,
                }],
            ));
        }
    }
    results
}

pub(in crate::ffui_core::engine) fn persist_terminal_logs_if_needed(
    mode: QueuePersistenceMode,
    retention: Option<CrashRecoveryLogRetention>,
    previous_snapshot: Option<&QueueStateLite>,
    current_snapshot: &QueueStateLite,
    resolve_full_job: impl Fn(&str) -> Option<TranscodeJob>,
) {
    if mode != QueuePersistenceMode::CrashRecoveryFull {
        return;
    }

    let retention = effective_log_retention(retention);
    enforce_terminal_log_retention(retention);

    let prev = previous_snapshot;

    for job in &current_snapshot.jobs {
        if !is_terminal_status(&job.status) {
            continue;
        }
        let was_terminal = prev
            .and_then(|p| p.jobs.iter().find(|j| j.id == job.id))
            .is_some_and(|j| is_terminal_status(&j.status));
        if was_terminal {
            continue;
        }

        let Some(full) = resolve_full_job(job.id.as_str()) else {
            continue;
        };
        if full.logs.is_empty() && full.runs.is_empty() {
            continue;
        }

        let runs = if full.runs.is_empty() {
            vec![JobRun {
                command: full.ffmpeg_command.clone().unwrap_or_default(),
                logs: full.logs.clone(),
                started_at_ms: full.start_time,
            }]
        } else {
            full.runs.clone()
        };
        persist_terminal_job_run_history(job.id.as_str(), &runs);
    }

    enforce_terminal_log_retention(retention);
}
