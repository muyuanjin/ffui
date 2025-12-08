use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(test)]
use crate::ffui_core::domain::TranscodeJob;
use crate::ffui_core::domain::{JobStatus, QueueState};

/// Path to the sidecar JSON file used for crash-recovery queue snapshots.
fn queue_state_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let stem = exe.file_stem()?.to_str()?;
    Some(dir.join(format!("{stem}.queue-state.json")))
}

pub(super) fn load_persisted_queue_state() -> Option<QueueState> {
    let path = queue_state_sidecar_path()?;
    if !path.exists() {
        return None;
    }

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(err) => {
            eprintln!(
                "failed to open persisted queue state {}: {err:#}",
                path.display()
            );
            return None;
        }
    };
    let reader = BufReader::new(file);
    match serde_json::from_reader::<_, QueueState>(reader) {
        Ok(state) => Some(state),
        Err(err) => {
            eprintln!(
                "failed to parse persisted queue state from {}: {err:#}",
                path.display()
            );
            None
        }
    }
}

/// Actual on-disk writer for queue state snapshots. This performs a single
/// compact JSON write without any debouncing semantics; callers should go
/// through `persist_queue_state` instead.
fn persist_queue_state_inner(snapshot: &QueueState) {
    let path = match queue_state_sidecar_path() {
        Some(p) => p,
        None => return,
    };

    if let Some(parent) = path.parent()
        && let Err(err) = fs::create_dir_all(parent)
    {
        eprintln!(
            "failed to create directory for queue state {}: {err:#}",
            parent.display()
        );
        return;
    }

    let tmp_path = path.with_extension("tmp");
    match fs::File::create(&tmp_path) {
        Ok(file) => {
            if let Err(err) = serde_json::to_writer(&file, snapshot) {
                eprintln!(
                    "failed to write queue state to {}: {err:#}",
                    tmp_path.display()
                );
                let _ = fs::remove_file(&tmp_path);
                return;
            }
            if let Err(err) = fs::rename(&tmp_path, &path) {
                eprintln!(
                    "failed to atomically rename {} -> {}: {err:#}",
                    tmp_path.display(),
                    path.display()
                );
                let _ = fs::remove_file(&tmp_path);
            }
        }
        Err(err) => {
            eprintln!(
                "failed to create temp queue state file {}: {err:#}",
                tmp_path.display()
            );
        }
    }
}

/// Debounce window for queue persistence writes. This reduces disk I/O on
/// hot paths (high-frequency progress updates) while still ensuring the first
/// snapshot is written promptly.
const QUEUE_PERSIST_DEBOUNCE_MS: u64 = 250;

/// In-memory state used to coalesce queue persistence writes across rapid
/// snapshots.
struct QueuePersistState {
    last_write_at: Option<Instant>,
    // Most recent snapshot observed since the last write. When the debounce
    // window elapses, this is the snapshot that will be persisted.
    last_snapshot: Option<QueueState>,
}

static QUEUE_PERSIST_STATE: once_cell::sync::Lazy<Mutex<QueuePersistState>> =
    once_cell::sync::Lazy::new(|| {
        Mutex::new(QueuePersistState {
            last_write_at: None,
            last_snapshot: None,
        })
    });

fn is_terminal_status(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

/// Detect whether the latest snapshot introduces any new terminal-state jobs
/// compared to the previous snapshot. This lets the debounced writer flush
/// immediately when a job finishes so crash-recovery does not resurrect
/// outdated paused/processing states on the next launch.
fn has_newly_terminal_jobs(prev: Option<&QueueState>, current: &QueueState) -> bool {
    use std::collections::HashMap;

    let mut prev_by_id: HashMap<&str, &JobStatus> = HashMap::new();
    if let Some(prev_state) = prev {
        for job in &prev_state.jobs {
            prev_by_id.insert(job.id.as_str(), &job.status);
        }
    }

    for job in &current.jobs {
        if !is_terminal_status(&job.status) {
            continue;
        }

        match prev_by_id.get(job.id.as_str()) {
            // Job was already terminal in the previous snapshot; no need to
            // treat it as "newly finished".
            Some(prev_status) if is_terminal_status(prev_status) => {}
            // Any terminal job that did not exist previously or has just
            // transitioned from a non-terminal state counts as newly terminal.
            _ => return true,
        }
    }

    false
}

/// Persist the given snapshot to disk using a debounced writer. The first
/// snapshot is written immediately; subsequent snapshots within the debounce
/// window are coalesced so that at most one write occurs per window while
/// still keeping a recent snapshot durable.
pub(super) fn persist_queue_state(snapshot: &QueueState) {
    let mut state = QUEUE_PERSIST_STATE
        .lock()
        .expect("queue persist state lock poisoned");

    let now = Instant::now();
    let has_newly_terminal = has_newly_terminal_jobs(state.last_snapshot.as_ref(), snapshot);
    state.last_snapshot = Some(snapshot.clone());

    match state.last_write_at {
        None => {
            // First snapshot: write immediately so there is always at least
            // one queue state persisted early in the session.
            state.last_write_at = Some(now);
            let to_write = state
                .last_snapshot
                .as_ref()
                .cloned()
                .unwrap_or_else(|| snapshot.clone());
            drop(state);
            persist_queue_state_inner(&to_write);
        }
        Some(last) => {
            let debounce = Duration::from_millis(QUEUE_PERSIST_DEBOUNCE_MS);
            if has_newly_terminal || now.duration_since(last) >= debounce {
                state.last_write_at = Some(now);
                let to_write = state
                    .last_snapshot
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| snapshot.clone());
                drop(state);
                persist_queue_state_inner(&to_write);
            }
            // If still within the debounce window, we keep last_snapshot
            // updated but avoid an immediate write; the next call after the
            // window elapses will flush the latest snapshot.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::domain::{JobSource, JobType};

    fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
        TranscodeJob {
            id: id.to_string(),
            filename: "C:/videos/test.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status,
            progress: 0.0,
            start_time: None,
            end_time: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: None,
            output_path: None,
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: None,
            wait_metadata: None,
        }
    }

    fn make_state(jobs: Vec<TranscodeJob>) -> QueueState {
        QueueState { jobs }
    }

    #[test]
    fn detects_newly_terminal_jobs_when_status_transitions_to_completed() {
        let prev = make_state(vec![make_job("job-1", JobStatus::Processing)]);
        let current = make_state(vec![make_job("job-1", JobStatus::Completed)]);

        assert!(
            has_newly_terminal_jobs(Some(&prev), &current),
            "transition from Processing to Completed should be treated as newly terminal",
        );
    }

    #[test]
    fn ignores_jobs_that_were_already_terminal() {
        let prev = make_state(vec![make_job("job-1", JobStatus::Completed)]);
        let current = make_state(vec![make_job("job-1", JobStatus::Completed)]);

        assert!(
            !has_newly_terminal_jobs(Some(&prev), &current),
            "terminal -> terminal transitions should not be treated as newly terminal",
        );
    }

    #[test]
    fn treats_terminal_jobs_as_new_when_no_previous_snapshot_exists() {
        let current = make_state(vec![make_job("job-1", JobStatus::Completed)]);
        assert!(
            has_newly_terminal_jobs(None, &current),
            "a terminal job in the first snapshot should be considered newly terminal",
        );
    }

    #[test]
    fn ignores_purely_non_terminal_changes() {
        let prev = make_state(vec![make_job("job-1", JobStatus::Processing)]);
        let current = make_state(vec![make_job("job-1", JobStatus::Processing)]);

        assert!(
            !has_newly_terminal_jobs(Some(&prev), &current),
            "no change in non-terminal status should not trigger newly-terminal detection",
        );
    }
}
