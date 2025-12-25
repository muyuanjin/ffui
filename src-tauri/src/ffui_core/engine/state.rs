#[cfg(test)]
use std::cell::Cell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Condvar, Mutex};

use super::state_persist::{
    peek_last_persisted_queue_state_lite, persist_queue_state_lite, persist_terminal_logs_if_needed,
};
use crate::ffui_core::domain::{
    AutoCompressProgress, FFmpegPreset, JobStatus, MediaInfo, QueueState, QueueStateLite,
    TranscodeJob, TranscodeJobLite,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::settings::types::QueuePersistenceMode;
use crate::sync_ext::MutexExt;

mod restore;

pub(super) use restore::restore_jobs_from_persisted_queue;

#[cfg(test)]
pub(super) fn restore_jobs_from_snapshot(inner: &Inner, snapshot: QueueState) {
    restore::restore_jobs_from_snapshot(inner, snapshot);
}

pub(super) const BATCH_COMPRESS_PROGRESS_EVERY: u64 = 32;

pub(super) type QueueListener = Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
pub(super) type QueueLiteListener = Arc<dyn Fn(QueueStateLite) + Send + Sync + 'static>;
pub(super) type BatchCompressProgressListener =
    Arc<dyn Fn(AutoCompressProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BatchCompressBatchStatus {
    Scanning,
    Running,
    Completed,
    #[allow(dead_code)]
    Failed,
}

#[derive(Debug, Clone)]
pub(crate) struct BatchCompressBatch {
    pub(crate) batch_id: String,
    pub(crate) root_path: String,
    /// 当前批次是否在压缩完成后替换原文件（移动到回收站并更新输出路径）。
    pub(crate) replace_original: bool,
    pub(crate) status: BatchCompressBatchStatus,
    pub(crate) total_files_scanned: u64,
    pub(crate) total_candidates: u64,
    pub(crate) total_processed: u64,
    pub(crate) child_job_ids: Vec<String>,
    #[allow(dead_code)]
    pub(crate) started_at_ms: u64,
    pub(crate) completed_at_ms: Option<u64>,
}

pub(crate) struct EngineState {
    pub(crate) presets: Arc<Vec<FFmpegPreset>>,
    pub(crate) settings: AppSettings,
    pub(crate) jobs: HashMap<String, TranscodeJob>,
    pub(crate) queue: VecDeque<String>,
    pub(crate) active_jobs: HashSet<String>,
    /// Number of transcoding worker threads spawned so far.
    pub(crate) spawned_workers: usize,
    /// Input paths (filenames) currently being processed by active workers.
    /// This is used to prevent concurrent transcodes of the same input from
    /// deadlocking on temp output collisions or platform file locks.
    pub(crate) active_inputs: HashSet<String>,
    pub(crate) cancelled_jobs: HashSet<String>,
    /// Monotonic token used to invalidate in-flight preview refresh tasks when
    /// previewCapturePercent changes multiple times quickly.
    pub(crate) preview_refresh_token: u64,
    // Jobs that have been asked to enter a "wait" state from the frontend.
    // The worker loop observes this and cooperatively pauses the job.
    pub(crate) wait_requests: HashSet<String>,
    // Jobs that should be restarted from 0% after their current run
    // terminates (for example via cooperative cancellation).
    pub(crate) restart_requests: HashSet<String>,
    // Per-input media metadata cache keyed by absolute input path. This avoids
    // repeated ffprobe calls when the same file is reused across jobs.
    pub(crate) media_info_cache: HashMap<String, MediaInfo>,
    // Batch Compress batches tracked by stable batch id so the frontend can build
    // composite cards from queue + progress events alone.
    pub(crate) batch_compress_batches: HashMap<String, BatchCompressBatch>,
    // Known Batch Compress output paths (both from current and previous runs).
    // These are used to avoid overwriting existing outputs and to skip
    // re-enqueuing Batch Compress outputs as new candidates.
    pub(crate) known_batch_compress_outputs: HashSet<String>,
}

impl EngineState {
    pub(crate) fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
        Self {
            presets: Arc::new(presets),
            settings,
            jobs: HashMap::new(),
            queue: VecDeque::new(),
            active_jobs: HashSet::new(),
            spawned_workers: 0,
            active_inputs: HashSet::new(),
            cancelled_jobs: HashSet::new(),
            preview_refresh_token: 0,
            wait_requests: HashSet::new(),
            restart_requests: HashSet::new(),
            media_info_cache: HashMap::new(),
            batch_compress_batches: HashMap::new(),
            known_batch_compress_outputs: HashSet::new(),
        }
    }
}

pub(crate) struct Inner {
    pub(crate) state: Mutex<EngineState>,
    pub(crate) cv: Condvar,
    pub(crate) next_job_id: AtomicU64,
    pub(crate) queue_recovery_done: AtomicBool,
    pub(crate) queue_listeners: Mutex<Vec<QueueListener>>,
    pub(crate) queue_lite_listeners: Mutex<Vec<QueueLiteListener>>,
    pub(crate) batch_compress_listeners: Mutex<Vec<BatchCompressProgressListener>>,
}

impl Inner {
    pub(crate) fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
        Self {
            state: Mutex::new(EngineState::new(presets, settings)),
            cv: Condvar::new(),
            next_job_id: AtomicU64::new(1),
            queue_recovery_done: AtomicBool::new(false),
            queue_listeners: Mutex::new(Vec::new()),
            queue_lite_listeners: Mutex::new(Vec::new()),
            batch_compress_listeners: Mutex::new(Vec::new()),
        }
    }
}

#[cfg(test)]
thread_local! {
    static SNAPSHOT_QUEUE_STATE_CALLS: Cell<usize> = const { Cell::new(0) };
}

#[cfg(test)]
pub(super) fn reset_snapshot_queue_state_calls() {
    SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.set(0));
}

#[cfg(test)]
pub(super) fn snapshot_queue_state_calls() -> usize {
    SNAPSHOT_QUEUE_STATE_CALLS.with(std::cell::Cell::get)
}

trait QueueOrderSortable {
    fn id_str(&self) -> &str;
    fn queue_order(&self) -> Option<u64>;
}

impl QueueOrderSortable for TranscodeJob {
    fn id_str(&self) -> &str {
        self.id.as_str()
    }

    fn queue_order(&self) -> Option<u64> {
        self.queue_order
    }
}

impl QueueOrderSortable for TranscodeJobLite {
    fn id_str(&self) -> &str {
        self.id.as_str()
    }

    fn queue_order(&self) -> Option<u64> {
        self.queue_order
    }
}

fn build_queue_order_map(state: &EngineState) -> HashMap<&str, u64> {
    let mut order_by_id: HashMap<&str, u64> = HashMap::with_capacity(state.queue.len());
    for (index, id) in state.queue.iter().enumerate() {
        order_by_id.insert(id.as_str(), index as u64);
    }
    order_by_id
}

fn sort_jobs_by_queue_order_and_id<J: QueueOrderSortable>(jobs: &mut [J]) {
    use std::cmp::Ordering;

    jobs.sort_by(|a, b| match (a.queue_order(), b.queue_order()) {
        (Some(aq), Some(bq)) => aq.cmp(&bq).then_with(|| a.id_str().cmp(b.id_str())),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a.id_str().cmp(b.id_str()),
    });
}

fn snapshot_queue_state_from_locked_state(state: &EngineState) -> QueueState {
    // Build a stable mapping from job id -> queue index so snapshots can
    // surface a `queueOrder` field for waiting jobs without mutating the
    // underlying engine state.
    let order_by_id = build_queue_order_map(state);

    let mut jobs: Vec<TranscodeJob> = Vec::with_capacity(state.jobs.len());
    for (id, job) in &state.jobs {
        let mut clone = job.clone();
        clone.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(clone);
    }

    sort_jobs_by_queue_order_and_id(&mut jobs);

    QueueState { jobs }
}

pub(super) fn snapshot_queue_state(inner: &Inner) -> QueueState {
    #[cfg(test)]
    SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.set(c.get() + 1));

    let state = inner.state.lock_unpoisoned();
    snapshot_queue_state_from_locked_state(&state)
}

fn snapshot_queue_state_lite_from_locked_state(state: &EngineState) -> QueueStateLite {
    let order_by_id = build_queue_order_map(state);

    let mut jobs: Vec<TranscodeJobLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in &state.jobs {
        let mut lite = TranscodeJobLite::from(job);
        lite.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(lite);
    }

    sort_jobs_by_queue_order_and_id(&mut jobs);

    QueueStateLite { jobs }
}

fn repair_queue_invariants_locked(state: &mut EngineState) {
    // Ensure the waiting queue is internally consistent so jobs never become
    // "stuck" due to state corruption, refactors, or crash-recovery edge cases.
    //
    // Invariants:
    // - `queue` contains unique job ids
    // - `queue` only contains ids for jobs that exist and are Waiting/Queued
    // - `active_jobs` only contains Processing jobs
    // - `active_inputs` matches `active_jobs`
    // - all Waiting/Queued jobs appear in `queue`
    let stale_active: Vec<String> = state
        .active_jobs
        .iter()
        .filter(|id| {
            state
                .jobs
                .get(*id)
                .is_none_or(|job| job.status != JobStatus::Processing)
        })
        .cloned()
        .collect();
    for id in stale_active {
        state.active_jobs.remove(&id);
    }
    state.active_inputs = state
        .active_jobs
        .iter()
        .filter_map(|id| state.jobs.get(id).map(|job| job.filename.clone()))
        .collect();

    let mut seen: HashSet<String> = HashSet::with_capacity(state.queue.len());
    state.queue.retain(|id| {
        if !seen.insert(id.clone()) {
            return false;
        }
        state
            .jobs
            .get(id)
            .is_some_and(|job| matches!(job.status, JobStatus::Waiting | JobStatus::Queued))
    });

    for (id, job) in &state.jobs {
        if !matches!(job.status, JobStatus::Waiting | JobStatus::Queued) {
            continue;
        }
        if seen.contains(id) {
            continue;
        }
        state.queue.push_back(id.clone());
        seen.insert(id.clone());
    }
}

pub(super) fn snapshot_queue_state_lite(inner: &Inner) -> QueueStateLite {
    let state = inner.state.lock_unpoisoned();
    snapshot_queue_state_lite_from_locked_state(&state)
}

pub(super) fn notify_queue_listeners(inner: &Inner) {
    let full_listeners = inner.queue_listeners.lock_unpoisoned().clone();
    let lite_listeners = inner.queue_lite_listeners.lock_unpoisoned().clone();

    let (lite_snapshot, full_snapshot, persistence_mode, retention) = {
        let mut state = inner.state.lock_unpoisoned();
        repair_queue_invariants_locked(&mut state);
        let lite = snapshot_queue_state_lite_from_locked_state(&state);
        let full = if full_listeners.is_empty() {
            None
        } else {
            #[cfg(test)]
            SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.set(c.get() + 1));
            Some(snapshot_queue_state_from_locked_state(&state))
        };
        (
            lite,
            full,
            state.settings.queue_persistence_mode,
            state.settings.crash_recovery_log_retention,
        )
    };

    let persist_snapshot = match persistence_mode {
        QueuePersistenceMode::CrashRecoveryLite | QueuePersistenceMode::CrashRecoveryFull => {
            Some(lite_snapshot.clone())
        }
        QueuePersistenceMode::None => {
            // Even when crash recovery is disabled, we still persist resumable jobs
            // so that forced kills/crashes can restore unfinished work. Terminal
            // jobs are excluded so the restart does not retain completed history.
            let mut filtered = lite_snapshot.clone();
            filtered.jobs.retain(|job| {
                matches!(
                    job.status,
                    JobStatus::Waiting
                        | JobStatus::Queued
                        | JobStatus::Paused
                        | JobStatus::Processing
                )
            });
            Some(filtered)
        }
    };

    if let Some(snapshot) = persist_snapshot {
        if matches!(persistence_mode, QueuePersistenceMode::CrashRecoveryFull) {
            // In full mode, persist per-job terminal logs only when jobs newly
            // transition into a terminal state. This avoids high-frequency I/O.
            let prev_snapshot = peek_last_persisted_queue_state_lite();
            persist_terminal_logs_if_needed(
                persistence_mode,
                retention,
                prev_snapshot.as_ref(),
                &snapshot,
                |job_id| {
                    let state = inner.state.lock_unpoisoned();
                    state.jobs.get(job_id).cloned()
                },
            );
        }
        persist_queue_state_lite(&snapshot);
    }

    for listener in &lite_listeners {
        listener(lite_snapshot.clone());
    }
    if let Some(full_snapshot) = full_snapshot {
        for listener in &full_listeners {
            listener(full_snapshot.clone());
        }
    }
}

pub(super) fn notify_batch_compress_listeners(inner: &Inner, progress: &AutoCompressProgress) {
    let listeners = inner.batch_compress_listeners.lock_unpoisoned().clone();
    for listener in &listeners {
        listener(progress.clone());
    }
}

pub(super) fn update_batch_compress_batch_with_inner<F>(
    inner: &Inner,
    batch_id: &str,
    force_notify: bool,
    f: F,
) where
    F: FnOnce(&mut BatchCompressBatch),
{
    let progress = {
        let mut state = inner.state.lock_unpoisoned();
        let Some(batch) = state.batch_compress_batches.get_mut(batch_id) else {
            return;
        };

        f(batch);

        if force_notify
            || batch
                .total_files_scanned
                .is_multiple_of(BATCH_COMPRESS_PROGRESS_EVERY)
        {
            Some(AutoCompressProgress {
                root_path: batch.root_path.clone(),
                total_files_scanned: batch.total_files_scanned,
                total_candidates: batch.total_candidates,
                total_processed: batch.total_processed,
                batch_id: batch.batch_id.clone(),
                completed_at_ms: batch.completed_at_ms.unwrap_or(0),
            })
        } else {
            None
        }
    };

    if let Some(progress) = progress {
        notify_batch_compress_listeners(inner, &progress);
    }
}

pub(super) fn register_known_batch_compress_output_with_inner(inner: &Inner, path: &Path) {
    let key = path.to_string_lossy().into_owned();
    let mut state = inner.state.lock_unpoisoned();
    state.known_batch_compress_outputs.insert(key);
}

pub(super) fn is_known_batch_compress_output_with_inner(inner: &Inner, path: &Path) -> bool {
    let key = path.to_string_lossy().into_owned();
    let state = inner.state.lock_unpoisoned();
    state.known_batch_compress_outputs.contains(&key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::JobStatus;
    use crate::test_support::make_transcode_job_for_tests;

    fn make_queue_order_test_state() -> EngineState {
        let mut state = EngineState::new(Vec::new(), AppSettings::default());
        state.queue.push_back("b".to_string());
        state.queue.push_back("a".to_string());

        state.jobs.insert(
            "c".to_string(),
            make_transcode_job_for_tests("c", JobStatus::Waiting, 0.0, None),
        );
        state.jobs.insert(
            "a".to_string(),
            make_transcode_job_for_tests("a", JobStatus::Waiting, 0.0, None),
        );
        state.jobs.insert(
            "b".to_string(),
            make_transcode_job_for_tests("b", JobStatus::Waiting, 0.0, None),
        );
        state
    }

    fn assert_queue_order_snapshot<J: QueueOrderSortable>(jobs: &[J]) {
        let ids: Vec<&str> = jobs.iter().map(super::QueueOrderSortable::id_str).collect();
        assert_eq!(ids, vec!["b", "a", "c"]);

        assert_eq!(jobs[0].queue_order(), Some(0));
        assert_eq!(jobs[1].queue_order(), Some(1));
        assert_eq!(jobs[2].queue_order(), None);
    }

    #[test]
    fn snapshot_queue_state_sorts_jobs_by_queue_order_then_id() {
        let state = make_queue_order_test_state();
        let snapshot = snapshot_queue_state_from_locked_state(&state);
        assert_queue_order_snapshot(&snapshot.jobs);

        let json = serde_json::to_value(&snapshot).expect("QueueState serializes");
        let jobs = json
            .get("jobs")
            .and_then(|v| v.as_array())
            .expect("jobs array present");
        assert_eq!(jobs[0].get("id").and_then(|v| v.as_str()), Some("b"));
        assert_eq!(
            jobs[0]
                .get("queueOrder")
                .and_then(serde_json::Value::as_u64),
            Some(0)
        );
    }

    #[test]
    fn snapshot_queue_state_lite_sorts_jobs_by_queue_order_then_id() {
        let state = make_queue_order_test_state();
        let snapshot = snapshot_queue_state_lite_from_locked_state(&state);
        assert_queue_order_snapshot(&snapshot.jobs);
    }
}
