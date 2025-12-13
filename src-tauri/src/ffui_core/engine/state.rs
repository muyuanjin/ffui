use crate::ffui_core::domain::{
    AutoCompressProgress, FFmpegPreset, JobStatus, JobType, MediaInfo, QueueState, QueueStateLite,
    TranscodeJob, TranscodeJobLite, WaitMetadata,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::settings::types::QueuePersistenceMode;
#[cfg(test)]
use std::cell::Cell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex};

use super::state_persist::{load_persisted_queue_state, persist_queue_state_lite};

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
    pub(crate) presets: Vec<FFmpegPreset>,
    pub(crate) settings: AppSettings,
    pub(crate) jobs: HashMap<String, TranscodeJob>,
    pub(crate) queue: VecDeque<String>,
    pub(crate) active_job: Option<String>,
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
            presets,
            settings,
            jobs: HashMap::new(),
            queue: VecDeque::new(),
            active_job: None,
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
    let mut order_by_id: HashMap<String, u64> = HashMap::new();
    for (index, id) in state.queue.iter().enumerate() {
        order_by_id.insert(id.clone(), index as u64);
    }

    let mut jobs: Vec<TranscodeJob> = Vec::with_capacity(state.jobs.len());
    for (id, job) in state.jobs.iter() {
        let mut clone = job.clone();
        clone.queue_order = order_by_id.get(id).copied();
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

    let mut order_by_id: HashMap<String, u64> = HashMap::new();
    for (index, id) in state.queue.iter().enumerate() {
        order_by_id.insert(id.clone(), index as u64);
    }

    let mut jobs: Vec<TranscodeJobLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in state.jobs.iter() {
        let mut lite = TranscodeJobLite::from(job);
        lite.queue_order = order_by_id.get(id).copied();
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

    let (lite_snapshot, full_snapshot, persistence_mode) = {
        let state = inner.state.lock().expect("engine state poisoned");
        let lite = snapshot_queue_state_lite_from_locked_state(&state);
        let full = if full_listeners.is_empty() {
            None
        } else {
            #[cfg(test)]
            SNAPSHOT_QUEUE_STATE_CALLS.with(|c| c.set(c.get() + 1));
            Some(snapshot_queue_state_from_locked_state(&state))
        };
        (lite, full, state.settings.queue_persistence_mode)
    };

    if persistence_mode == QueuePersistenceMode::CrashRecovery {
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

pub(super) fn restore_jobs_from_persisted_queue(inner: &Inner) {
    // Respect the configured queue persistence mode; when disabled we skip
    // loading any previous queue snapshot and start from a clean state.
    {
        let state = inner.state.lock().expect("engine state poisoned");
        if state.settings.queue_persistence_mode != QueuePersistenceMode::CrashRecovery {
            return;
        }
    }

    let snapshot = match load_persisted_queue_state() {
        Some(s) => s,
        None => return,
    };
    restore_jobs_from_snapshot(inner, snapshot);
}

pub fn restore_jobs_from_snapshot(inner: &Inner, snapshot: QueueState) {
    // Ensure that newly enqueued jobs after recovery do not reuse IDs from the
    // restored snapshot. Otherwise inserting into the HashMap<String, TranscodeJob>
    // would overwrite existing entries and appear to "replace" existing tasks.
    let mut max_numeric_id: u64 = 0;
    for job in &snapshot.jobs {
        if let Some(suffix) = job.id.strip_prefix("job-")
            && let Ok(n) = suffix.parse::<u64>()
            && n > max_numeric_id
        {
            max_numeric_id = n;
        }
    }
    if max_numeric_id > 0 {
        let current = inner.next_job_id.load(std::sync::atomic::Ordering::SeqCst);
        inner.next_job_id.store(
            current.max(max_numeric_id + 1),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    let mut waiting: Vec<(u64, String)> = Vec::new();
    let mut tmp_output_candidates: Vec<(String, PathBuf, f64, Option<u64>)> = Vec::new();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        for mut job in snapshot.jobs {
            let id = job.id.clone();

            // If a job with the same id was already enqueued in this run,
            // keep the in-memory version and skip the persisted one.
            if state.jobs.contains_key(&id) {
                continue;
            }

            // Jobs that were previously in Processing are treated as Paused so
            // they do not auto-resume on startup but remain recoverable.
            if job.status == JobStatus::Processing {
                job.status = JobStatus::Paused;
                job.logs.push(
                    "Recovered after unexpected shutdown; job did not finish in previous run."
                        .to_string(),
                );
            }

            let persisted_order = job.queue_order;
            job.queue_order = None;

            // Best-effort crash recovery metadata for video jobs that had
            // already made some progress. When a temp output exists but no
            // WaitMetadata was recorded (for example due to a power loss),
            // attach the path so a later resume can attempt concat-based
            // continuation instead of always restarting from 0%.
            // 处理耗时基线属于运行期信息，恢复时清空，待重新进入 Processing 时再设置。
            job.processing_started_ms = None;
            if matches!(job.job_type, JobType::Video)
                && matches!(
                    job.status,
                    JobStatus::Waiting | JobStatus::Queued | JobStatus::Paused
                )
                && job.wait_metadata.is_none()
            {
                let tmp_output = build_video_tmp_output_path(Path::new(&job.filename));
                tmp_output_candidates.push((id.clone(), tmp_output, job.progress, job.elapsed_ms));
            }

            if matches!(job.status, JobStatus::Waiting | JobStatus::Queued) {
                let order = persisted_order.unwrap_or(u64::MAX);
                waiting.push((order, id.clone()));
            }

            state.jobs.insert(id, job);
        }

        waiting.sort_by(|(ao, aid), (bo, bid)| ao.cmp(bo).then(aid.cmp(bid)));

        let recovered_ids: Vec<String> = waiting.drain(..).map(|(_, id)| id).collect();
        let recovered_set: HashSet<String> = recovered_ids.iter().cloned().collect();
        let existing_ids: Vec<String> = state.queue.iter().cloned().collect();

        let mut next_queue: VecDeque<String> = VecDeque::new();
        for id in recovered_ids {
            if !next_queue.contains(&id) {
                next_queue.push_back(id);
            }
        }
        for id in existing_ids {
            if !recovered_set.contains(&id) && !next_queue.contains(&id) {
                next_queue.push_back(id);
            }
        }

        state.queue = next_queue;
    }

    // Perform any filesystem probes (e.g. temp output existence checks)
    // outside the engine lock to avoid blocking concurrent queue snapshots.
    if !tmp_output_candidates.is_empty() {
        let mut recovered_tmp_outputs: Vec<(String, String, f64, Option<u64>)> = Vec::new();
        for (id, tmp_output, progress, elapsed_ms) in tmp_output_candidates {
            if tmp_output.exists() {
                let tmp_str = tmp_output.to_string_lossy().into_owned();
                recovered_tmp_outputs.push((id, tmp_str, progress, elapsed_ms));
            }
        }

        if !recovered_tmp_outputs.is_empty() {
            let mut state = inner.state.lock().expect("engine state poisoned");
            for (id, tmp_str, progress, elapsed_ms) in recovered_tmp_outputs {
                if let Some(job) = state.jobs.get_mut(&id)
                    && job.wait_metadata.is_none()
                {
                    job.wait_metadata = Some(WaitMetadata {
                        last_progress_percent: Some(progress),
                        processed_wall_millis: elapsed_ms,
                        processed_seconds: None,
                        tmp_output_path: Some(tmp_str.clone()),
                        segments: Some(vec![tmp_str]),
                    });
                }
            }
        }
    }

    // Emit a snapshot so the frontend sees the recovered queue without having
    // to poll immediately after startup.
    notify_queue_listeners(inner);

    // Wake any worker threads that might already be waiting for work so they
    // can immediately observe the recovered queue instead of staying parked
    // on the condition variable until a brand-new job is enqueued.
    inner.cv.notify_all();
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

// Helper function referenced in restore_jobs_from_snapshot
fn build_video_tmp_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.tmp.{ext}"))
}
