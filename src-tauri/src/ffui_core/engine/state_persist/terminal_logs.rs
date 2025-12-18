use std::fs;
use std::path::PathBuf;
#[cfg(test)]
use std::sync::Mutex;
#[cfg(test)]
use std::sync::atomic::Ordering;

#[cfg(test)]
use super::AtomicU64;
use crate::ffui_core::domain::{
    JobStatus,
    QueueStateLite,
    TranscodeJob,
};
use crate::ffui_core::settings::types::{
    CrashRecoveryLogRetention,
    QueuePersistenceMode,
};

#[cfg(test)]
static QUEUE_LOGS_DIR_OVERRIDE: once_cell::sync::Lazy<Mutex<Option<PathBuf>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[cfg(test)]
pub(in crate::ffui_core::engine) struct QueueLogsDirGuard;

#[cfg(test)]
impl Drop for QueueLogsDirGuard {
    fn drop(&mut self) {
        let mut override_dir = QUEUE_LOGS_DIR_OVERRIDE
            .lock()
            .expect("queue logs dir override lock poisoned");
        *override_dir = None;
    }
}

#[cfg(test)]
pub(in crate::ffui_core::engine) fn override_queue_logs_dir_for_tests(
    dir: PathBuf,
) -> QueueLogsDirGuard {
    let mut override_dir = QUEUE_LOGS_DIR_OVERRIDE
        .lock()
        .expect("queue logs dir override lock poisoned");
    *override_dir = Some(dir);
    QueueLogsDirGuard
}

fn queue_logs_dir() -> Option<PathBuf> {
    #[cfg(test)]
    {
        let override_dir = QUEUE_LOGS_DIR_OVERRIDE
            .lock()
            .expect("queue logs dir override lock poisoned");
        if let Some(dir) = override_dir.as_ref() {
            return Some(dir.clone());
        }
    }

    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let stem = exe.file_stem()?.to_str()?;
    Some(dir.join(format!("{stem}.queue-logs")))
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

pub(in crate::ffui_core::engine) fn is_terminal_status(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

#[cfg(test)]
pub(in crate::ffui_core::engine) static TERMINAL_LOG_WRITE_COUNT: AtomicU64 = AtomicU64::new(0);

fn persist_terminal_job_log(job_id: &str, logs: &[String]) {
    let path = match queue_job_log_path(job_id) {
        Some(p) => p,
        None => return,
    };
    let dir = match path.parent() {
        Some(p) => p,
        None => return,
    };
    if let Err(err) = fs::create_dir_all(dir) {
        eprintln!(
            "failed to create queue logs directory {}: {err:#}",
            dir.display()
        );
        return;
    }

    let tmp_path = path.with_extension("tmp");
    match fs::File::create(&tmp_path) {
        Ok(mut file) => {
            use std::io::Write;
            for (idx, line) in logs.iter().enumerate() {
                if idx > 0 {
                    let _ = file.write_all(b"\n");
                }
                if let Err(err) = file.write_all(line.as_bytes()) {
                    eprintln!(
                        "failed to write terminal job log {}: {err:#}",
                        tmp_path.display()
                    );
                    let _ = fs::remove_file(&tmp_path);
                    return;
                }
            }
            if let Err(err) = fs::rename(&tmp_path, &path) {
                eprintln!(
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
            eprintln!(
                "failed to create temp terminal job log file {}: {err:#}",
                tmp_path.display()
            );
        }
    }
}

fn enforce_terminal_log_retention(retention: CrashRecoveryLogRetention) {
    let dir = match queue_logs_dir() {
        Some(d) => d,
        None => return,
    };
    if !dir.exists() {
        return;
    }

    let max_files = retention.max_files.unwrap_or(0) as usize;
    let max_total_bytes = (retention.max_total_mb.unwrap_or(0) as u64)
        .saturating_mul(1024)
        .saturating_mul(1024);

    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total_bytes: u64 = 0;

    let read_dir = match fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(err) => {
            eprintln!(
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
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
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
) -> Vec<(String, Vec<String>)> {
    // Apply retention before reading so we don't load logs that are about to be deleted.
    enforce_terminal_log_retention(retention);

    let mut results = Vec::new();
    for job_id in job_ids {
        let Some(path) = queue_job_log_path(job_id) else {
            continue;
        };
        let data = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let lines = data
            .lines()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            results.push((job_id.clone(), lines));
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
            .map(|j| is_terminal_status(&j.status))
            .unwrap_or(false);
        if was_terminal {
            continue;
        }

        let Some(full) = resolve_full_job(job.id.as_str()) else {
            continue;
        };
        if full.logs.is_empty() {
            continue;
        }
        persist_terminal_job_log(job.id.as_str(), &full.logs);
    }

    enforce_terminal_log_retention(retention);
}
