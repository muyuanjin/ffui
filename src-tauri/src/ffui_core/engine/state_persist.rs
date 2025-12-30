use std::fs;
use std::path::PathBuf;
#[cfg(test)]
use std::sync::atomic::Ordering;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::ffui_core::domain::{
    JobRecord, JobStatus, QueueState, QueueStateLite, TranscodeJobLite,
};
use crate::sync_ext::{CondvarExt, MutexExt};

mod persisted_queue_state;
#[cfg(test)]
#[path = "state_persist_test_support.rs"]
mod state_persist_test_support;
mod terminal_logs;
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use state_persist_test_support::{
    QueueStateSidecarPathGuard, override_queue_state_sidecar_path_for_tests,
};
#[cfg(test)]
pub(super) use terminal_logs::TERMINAL_LOG_WRITE_COUNT;
pub(super) use terminal_logs::{load_persisted_terminal_job_logs, persist_terminal_logs_if_needed};
#[cfg(test)]
pub(super) use terminal_logs::{override_queue_logs_dir_for_tests, queue_job_log_path};
#[cfg(test)]
pub(super) fn queue_state_sidecar_path_overridden_for_tests() -> bool {
    state_persist_test_support::queue_state_sidecar_path_overridden_for_tests()
}
#[cfg(test)]
pub(crate) type PersistTestMutexGuard = state_persist_test_support::PersistTestMutexGuard;
#[cfg(test)]
pub(crate) fn lock_persist_test_mutex_for_tests() -> PersistTestMutexGuard {
    state_persist_test_support::lock_persist_test_mutex_for_tests()
}
#[cfg(test)]
pub(super) static QUEUE_PERSIST_WRITE_COUNT: &std::sync::atomic::AtomicU64 =
    &state_persist_test_support::QUEUE_PERSIST_WRITE_COUNT;

static QUEUE_PERSIST_WRITE_MUTEX: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

/// Path to the sidecar JSON file used for crash-recovery queue snapshots.
fn queue_state_sidecar_path() -> Option<PathBuf> {
    #[cfg(test)]
    {
        if let Some(path) = state_persist_test_support::queue_state_sidecar_path_override() {
            return Some(path);
        }
    }

    if let Ok(raw) = std::env::var("FFUI_QUEUE_STATE_SIDECAR_PATH") {
        let normalized = raw.trim();
        if !normalized.is_empty() {
            return Some(PathBuf::from(normalized));
        }
    }

    crate::ffui_core::queue_state_path().ok()
}

pub(super) fn persisted_queue_state_exists_on_disk() -> bool {
    queue_state_sidecar_path().is_some_and(|path| path.exists())
}

#[cfg(feature = "bench")]
pub(super) fn decode_persisted_queue_state_bytes_for_bench(data: &[u8]) -> Option<QueueState> {
    persisted_queue_state::decode_persisted_queue_state_bytes_for_bench(data)
}

pub(super) fn load_persisted_queue_state() -> Option<QueueState> {
    let path = queue_state_sidecar_path()?;
    if !path.exists() {
        return None;
    }

    let data = match fs::read(&path) {
        Ok(data) => data,
        Err(err) => {
            crate::debug_eprintln!(
                "failed to read persisted queue state {}: {err:#}",
                path.display()
            );
            return None;
        }
    };
    let mut rewrite = false;
    let lite = match persisted_queue_state::decode_persisted_queue_state_bytes(&data) {
        Some(persisted_queue_state::DecodedPersistedQueueState::V1(mut v1)) => {
            if v1.version != persisted_queue_state::PERSISTED_QUEUE_STATE_VERSION {
                v1.version = persisted_queue_state::PERSISTED_QUEUE_STATE_VERSION;
                rewrite = true;
            }

            let mut records = v1.jobs;
            for record in &mut records {
                if record.canonicalize_and_upgrade_for_persistence() {
                    rewrite = true;
                }
            }

            QueueStateLite {
                snapshot_revision: v1.snapshot_revision,
                jobs: records.into_iter().map(TranscodeJobLite::from).collect(),
            }
        }
        Some(persisted_queue_state::DecodedPersistedQueueState::Lite(lite)) => {
            rewrite = true;
            lite
        }
        Some(persisted_queue_state::DecodedPersistedQueueState::Full(full)) => {
            rewrite = true;
            let mut full = full;
            for job in &mut full.jobs {
                if job.log_tail.is_none() {
                    super::worker_utils::recompute_log_tail(job);
                }
                job.ensure_run_history_from_legacy();
            }
            QueueStateLite {
                snapshot_revision: 0,
                jobs: full.jobs.iter().map(TranscodeJobLite::from).collect(),
            }
        }
        None => {
            crate::debug_eprintln!(
                "failed to parse persisted queue state from {}: unable to decode as v1, full, or lite schema",
                path.display()
            );
            return None;
        }
    };

    if rewrite {
        persist_queue_state_lite_immediate(&lite);
    }

    let mut snapshot = QueueState::from(lite);
    for job in &mut snapshot.jobs {
        job.ensure_run_history_from_legacy();
    }
    Some(snapshot)
}

/// Actual on-disk writer for queue state snapshots. This performs a single
/// compact JSON write without any debouncing semantics; callers should go
/// through `persist_queue_state_lite` instead.
fn persist_queue_state_inner(snapshot: &QueueStateLite, epoch: u64) {
    if should_abort_queue_persist_write_for_tests(epoch) {
        return;
    }

    let Some(path) = queue_state_sidecar_path() else {
        return;
    };

    let _write_guard = QUEUE_PERSIST_WRITE_MUTEX.lock_unpoisoned();

    if let Some(parent) = path.parent()
        && let Err(err) = fs::create_dir_all(parent)
    {
        crate::debug_eprintln!(
            "failed to create directory for queue state {}: {err:#}",
            parent.display()
        );
        return;
    }

    let tmp_path = path.with_extension("tmp");
    match fs::File::create(&tmp_path) {
        Ok(file) => {
            let persisted = persisted_queue_state::PersistedQueueStateFile {
                version: persisted_queue_state::PERSISTED_QUEUE_STATE_VERSION,
                snapshot_revision: snapshot.snapshot_revision,
                jobs: snapshot.jobs.iter().cloned().map(JobRecord::from).collect(),
            };
            if let Err(err) = serde_json::to_writer(&file, &persisted) {
                crate::debug_eprintln!(
                    "failed to write queue state to {}: {err:#}",
                    tmp_path.display()
                );
                drop(fs::remove_file(&tmp_path));
                return;
            }
            // Ensure the file handle is closed before attempting an atomic rename.
            // On Windows, renaming an open file will fail (and tests may observe
            // the sidecar as missing).
            drop(file);
            if let Err(err) = fs::rename(&tmp_path, &path) {
                crate::debug_eprintln!(
                    "failed to atomically rename {} -> {}: {err:#}",
                    tmp_path.display(),
                    path.display()
                );
                drop(fs::remove_file(&tmp_path));
            }
        }
        Err(err) => {
            crate::debug_eprintln!(
                "failed to create temp queue state file {}: {err:#}",
                tmp_path.display()
            );
        }
    }

    #[cfg(test)]
    QUEUE_PERSIST_WRITE_COUNT.fetch_add(1, Ordering::SeqCst);
}

/// Debounce window for queue persistence writes. This reduces disk I/O on
/// hot paths (high-frequency progress updates) while still ensuring the first
/// snapshot is written promptly.
const QUEUE_PERSIST_DEBOUNCE_MS: u64 = if cfg!(test) { 40 } else { 250 };

fn current_queue_persist_epoch() -> u64 {
    #[cfg(test)]
    {
        state_persist_test_support::current_queue_persist_epoch_for_tests()
    }
    #[cfg(not(test))]
    {
        0
    }
}

fn should_abort_queue_persist_write_for_tests(epoch: u64) -> bool {
    #[cfg(test)]
    {
        state_persist_test_support::should_abort_queue_persist_write_for_tests(epoch)
    }
    #[cfg(not(test))]
    {
        let _ = epoch;
        false
    }
}

/// In-memory state used to coalesce queue persistence writes across rapid
/// snapshots.
struct QueuePersistState {
    last_write_at: Option<Instant>,
    // Most recent snapshot observed since the last write. When the debounce
    // window elapses, this is the snapshot that will be persisted.
    last_snapshot: Option<QueueStateLite>,
    dirty_since_write: bool,
    next_flush_at: Option<Instant>,
    worker_started: bool,
}

struct QueuePersistCoordinator {
    state: Mutex<QueuePersistState>,
    cv: Condvar,
}

impl QueuePersistCoordinator {
    const fn new() -> Self {
        Self {
            state: Mutex::new(QueuePersistState {
                last_write_at: None,
                last_snapshot: None,
                dirty_since_write: false,
                next_flush_at: None,
                worker_started: false,
            }),
            cv: Condvar::new(),
        }
    }
}

static QUEUE_PERSIST: once_cell::sync::Lazy<QueuePersistCoordinator> =
    once_cell::sync::Lazy::new(QueuePersistCoordinator::new);

#[cfg(test)]
pub(super) fn reset_queue_persist_state_for_tests() {
    state_persist_test_support::bump_queue_persist_epoch_for_tests();
    let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
    state.last_write_at = None;
    state.last_snapshot = None;
    state.dirty_since_write = false;
    state.next_flush_at = None;
    // Keep worker_started as-is; stopping/spawning threads is intentionally
    // avoided in unit tests. The mutex above serializes test access.
}

pub(super) fn peek_last_persisted_queue_state_lite() -> Option<QueueStateLite> {
    let state = QUEUE_PERSIST.state.lock_unpoisoned();
    state.last_snapshot.clone()
}

/// Detect whether the latest snapshot introduces any new terminal-state jobs
/// compared to the previous snapshot. This lets the debounced writer flush
/// immediately when a job finishes so crash-recovery does not resurrect
/// outdated paused/processing states on the next launch.
fn has_newly_terminal_jobs(prev: Option<&QueueStateLite>, current: &QueueStateLite) -> bool {
    use std::collections::HashMap;

    let mut prev_by_id: HashMap<&str, &JobStatus> = HashMap::new();
    if let Some(prev_state) = prev {
        for job in &prev_state.jobs {
            prev_by_id.insert(job.id.as_str(), &job.status);
        }
    }

    for job in &current.jobs {
        if !terminal_logs::is_terminal_status(&job.status) {
            continue;
        }

        match prev_by_id.get(job.id.as_str()) {
            // Job was already terminal in the previous snapshot; no need to
            // treat it as "newly finished".
            Some(prev_status) if terminal_logs::is_terminal_status(prev_status) => {}
            // Any terminal job that did not exist previously or has just
            // transitioned from a non-terminal state counts as newly terminal.
            _ => return true,
        }
    }

    false
}

fn ensure_worker_thread_started() {
    let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
    if state.worker_started {
        return;
    }
    state.worker_started = true;
    drop(state);

    let spawned = std::thread::Builder::new()
        .name("ffui-queue-persist".to_string())
        .spawn(|| {
            loop {
                let maybe_snapshot = {
                    let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
                    loop {
                        let Some(deadline) = state.next_flush_at else {
                            state = QUEUE_PERSIST.cv.wait_unpoisoned(state);
                            continue;
                        };

                        let now = Instant::now();
                        if now >= deadline {
                            break;
                        }

                        let timeout = deadline.saturating_duration_since(now);
                        let (next, _) = QUEUE_PERSIST.cv.wait_timeout_unpoisoned(state, timeout);
                        state = next;
                    }

                    if state.dirty_since_write {
                        let snapshot = state.last_snapshot.clone();
                        let epoch = current_queue_persist_epoch();
                        state.last_write_at = Some(Instant::now());
                        state.dirty_since_write = false;
                        state.next_flush_at = None;
                        snapshot.map(|snapshot| (epoch, snapshot))
                    } else {
                        state.next_flush_at = None;
                        None
                    }
                };

                if let Some((epoch, snapshot)) = maybe_snapshot {
                    persist_queue_state_inner(&snapshot, epoch);
                }
            }
        })
        .map(|_| ());

    if let Err(err) = spawned {
        // Allow a later retry instead of leaving the persistence worker stuck
        // in an unstarted state.
        let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
        state.worker_started = false;
        drop(state);
        QUEUE_PERSIST.cv.notify_all();
        crate::debug_eprintln!("failed to spawn queue persistence thread: {err}");
    }
}

/// Persist the given snapshot immediately, bypassing the debounce window.
///
/// This is used by graceful shutdown paths that need to ensure crash-recovery
/// metadata (such as wait segments) is durable before the process exits.
pub(super) fn persist_queue_state_lite_immediate(snapshot: &QueueStateLite) {
    #[cfg(test)]
    let _test_guard = lock_persist_test_mutex_for_tests();

    ensure_worker_thread_started();

    let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
    let epoch = current_queue_persist_epoch();
    state.last_snapshot = Some(snapshot.clone());
    state.last_write_at = Some(Instant::now());
    state.dirty_since_write = false;
    state.next_flush_at = None;
    drop(state);

    persist_queue_state_inner(snapshot, epoch);
    QUEUE_PERSIST.cv.notify_all();
}

/// Persist the given snapshot to disk using a debounced writer. The first
/// snapshot is written immediately; subsequent snapshots within the debounce
/// window are coalesced so that at most one write occurs per window while
/// still keeping the latest snapshot durable.
pub(super) fn persist_queue_state_lite(snapshot: &QueueStateLite) {
    #[cfg(test)]
    let _test_guard = lock_persist_test_mutex_for_tests();

    ensure_worker_thread_started();

    let mut state = QUEUE_PERSIST.state.lock_unpoisoned();
    let now = Instant::now();
    let epoch = current_queue_persist_epoch();
    let has_newly_terminal = has_newly_terminal_jobs(state.last_snapshot.as_ref(), snapshot);
    state.last_snapshot = Some(snapshot.clone());
    state.dirty_since_write = true;

    match state.last_write_at {
        None => {
            // First snapshot: write immediately so there is always at least
            // one queue state persisted early in the session.
            state.last_write_at = Some(now);
            state.dirty_since_write = false;
            state.next_flush_at = None;
            let to_write = state
                .last_snapshot
                .clone()
                .unwrap_or_else(|| snapshot.clone());
            drop(state);
            persist_queue_state_inner(&to_write, epoch);
        }
        Some(last) => {
            let debounce = Duration::from_millis(QUEUE_PERSIST_DEBOUNCE_MS);
            if has_newly_terminal || now.duration_since(last) >= debounce {
                state.last_write_at = Some(now);
                state.dirty_since_write = false;
                state.next_flush_at = None;
                let to_write = state
                    .last_snapshot
                    .clone()
                    .unwrap_or_else(|| snapshot.clone());
                drop(state);
                persist_queue_state_inner(&to_write, epoch);
                QUEUE_PERSIST.cv.notify_all();
                return;
            }
            // Still within the debounce window: schedule a background flush
            // so the latest snapshot is persisted even if no more updates
            // arrive after the burst ends.
            let flush_at = last + debounce;
            state.next_flush_at = Some(
                state
                    .next_flush_at
                    .map_or(flush_at, |existing| existing.min(flush_at)),
            );
            QUEUE_PERSIST.cv.notify_all();
        }
    }
}

#[cfg(test)]
mod tests;
