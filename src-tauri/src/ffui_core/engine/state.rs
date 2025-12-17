use crate::ffui_core::domain::{
    AutoCompressProgress, FFmpegPreset, MediaInfo, QueueState, QueueStateLite, TranscodeJob,
    TranscodeJobLite,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::settings::types::QueuePersistenceMode;
#[cfg(test)]
use std::cell::Cell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex};

use super::state_persist::{
    peek_last_persisted_queue_state_lite, persist_queue_state_lite, persist_terminal_logs_if_needed,
};

mod restore;

pub(super) use restore::restore_jobs_from_persisted_queue;

#[cfg(test)]
pub(super) fn restore_jobs_from_snapshot(inner: &Inner, snapshot: QueueState) {
    restore::restore_jobs_from_snapshot(inner, snapshot);
}

const SMART_SCAN_PROGRESS_EVERY: u64 = 32;

pub(super) type QueueListener = Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
pub(super) type QueueLiteListener = Arc<dyn Fn(QueueStateLite) + Send + Sync + 'static>;
pub(super) type SmartScanProgressListener =
    Arc<dyn Fn(AutoCompressProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SmartScanBatchStatus {
    Scanning,
    Running,
    Completed,
    #[allow(dead_code)]
    Failed,
}

#[derive(Debug, Clone)]
pub(crate) struct SmartScanBatch {
    pub(crate) batch_id: String,
    pub(crate) root_path: String,
    /// 当前批次是否在压缩完成后替换原文件（移动到回收站并更新输出路径）。
    pub(crate) replace_original: bool,
    pub(crate) status: SmartScanBatchStatus,
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
    // Smart Scan batches tracked by stable batch id so the frontend can build
    // composite cards from queue + progress events alone.
    pub(crate) smart_scan_batches: HashMap<String, SmartScanBatch>,
    // Known Smart Scan output paths (both from current and previous runs).
    // These are used to avoid overwriting existing outputs and to skip
    // re-enqueuing Smart Scan outputs as new candidates.
    pub(crate) known_smart_scan_outputs: HashSet<String>,
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
            smart_scan_batches: HashMap::new(),
            known_smart_scan_outputs: HashSet::new(),
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
    pub(crate) smart_scan_listeners: Mutex<Vec<SmartScanProgressListener>>,
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
            smart_scan_listeners: Mutex::new(Vec::new()),
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
    SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.get())
}

fn snapshot_queue_state_from_locked_state(state: &EngineState) -> QueueState {
    use std::collections::HashMap;

    // Build a stable mapping from job id -> queue index so snapshots can
    // surface a `queueOrder` field for waiting jobs without mutating the
    // underlying engine state.
    let mut order_by_id: HashMap<&str, u64> = HashMap::with_capacity(state.queue.len());
    for (index, id) in state.queue.iter().enumerate() {
        order_by_id.insert(id.as_str(), index as u64);
    }

    let mut jobs: Vec<TranscodeJob> = Vec::with_capacity(state.jobs.len());
    for (id, job) in state.jobs.iter() {
        let mut clone = job.clone();
        clone.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(clone);
    }

    QueueState { jobs }
}

pub(super) fn snapshot_queue_state(inner: &Inner) -> QueueState {
    #[cfg(test)]
    SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.set(c.get() + 1));

    let state = inner.state.lock().expect("engine state poisoned");
    snapshot_queue_state_from_locked_state(&state)
}

fn snapshot_queue_state_lite_from_locked_state(state: &EngineState) -> QueueStateLite {
    use std::collections::HashMap;

    let mut order_by_id: HashMap<&str, u64> = HashMap::with_capacity(state.queue.len());
    for (index, id) in state.queue.iter().enumerate() {
        order_by_id.insert(id.as_str(), index as u64);
    }

    let mut jobs: Vec<TranscodeJobLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in state.jobs.iter() {
        let mut lite = TranscodeJobLite::from(job);
        lite.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(lite);
    }

    QueueStateLite { jobs }
}

pub(super) fn snapshot_queue_state_lite(inner: &Inner) -> QueueStateLite {
    let state = inner.state.lock().expect("engine state poisoned");
    snapshot_queue_state_lite_from_locked_state(&state)
}

pub(super) fn notify_queue_listeners(inner: &Inner) {
    let full_listeners = inner
        .queue_listeners
        .lock()
        .expect("queue listeners lock poisoned")
        .clone();
    let lite_listeners = inner
        .queue_lite_listeners
        .lock()
        .expect("queue lite listeners lock poisoned")
        .clone();

    let (lite_snapshot, full_snapshot, persistence_mode, retention) = {
        let state = inner.state.lock().expect("engine state poisoned");
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

    if matches!(
        persistence_mode,
        QueuePersistenceMode::CrashRecoveryLite | QueuePersistenceMode::CrashRecoveryFull
    ) {
        // In full mode, persist per-job terminal logs only when jobs newly
        // transition into a terminal state. This avoids high-frequency I/O.
        let prev_snapshot = peek_last_persisted_queue_state_lite();
        persist_terminal_logs_if_needed(
            persistence_mode,
            retention,
            prev_snapshot.as_ref(),
            &lite_snapshot,
            |job_id| {
                let state = inner.state.lock().expect("engine state poisoned");
                state.jobs.get(job_id).cloned()
            },
        );
        persist_queue_state_lite(&lite_snapshot);
    }

    for listener in lite_listeners.iter() {
        listener(lite_snapshot.clone());
    }
    if let Some(full_snapshot) = full_snapshot {
        for listener in full_listeners.iter() {
            listener(full_snapshot.clone());
        }
    }
}

pub(super) fn notify_smart_scan_listeners(inner: &Inner, progress: AutoCompressProgress) {
    let listeners = inner
        .smart_scan_listeners
        .lock()
        .expect("smart scan listeners lock poisoned");
    for listener in listeners.iter() {
        listener(progress.clone());
    }
}

pub(super) fn update_smart_scan_batch_with_inner<F>(
    inner: &Inner,
    batch_id: &str,
    force_notify: bool,
    f: F,
) where
    F: FnOnce(&mut SmartScanBatch),
{
    let progress = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let batch = match state.smart_scan_batches.get_mut(batch_id) {
            Some(b) => b,
            None => return,
        };

        f(batch);

        if force_notify
            || batch
                .total_files_scanned
                .is_multiple_of(SMART_SCAN_PROGRESS_EVERY)
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
        notify_smart_scan_listeners(inner, progress);
    }
}

pub(super) fn register_known_smart_scan_output_with_inner(inner: &Inner, path: &Path) {
    let key = path.to_string_lossy().into_owned();
    let mut state = inner.state.lock().expect("engine state poisoned");
    state.known_smart_scan_outputs.insert(key);
}

pub(super) fn is_known_smart_scan_output_with_inner(inner: &Inner, path: &Path) -> bool {
    let key = path.to_string_lossy().into_owned();
    let state = inner.state.lock().expect("engine state poisoned");
    state.known_smart_scan_outputs.contains(&key)
}
