use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::ffui_core::domain::{
    AutoCompressProgress, FFmpegPreset, JobStatus, JobType, MediaInfo, QueueState, TranscodeJob,
    WaitMetadata,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::settings::types::QueuePersistenceMode;

const SMART_SCAN_PROGRESS_EVERY: u64 = 32;

pub(super) type QueueListener = Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
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
    pub(crate) smart_scan_listeners: Mutex<Vec<SmartScanProgressListener>>,
}

impl Inner {
    pub(crate) fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
        Self {
            state: Mutex::new(EngineState::new(presets, settings)),
            cv: Condvar::new(),
            next_job_id: AtomicU64::new(1),
            queue_listeners: Mutex::new(Vec::new()),
            smart_scan_listeners: Mutex::new(Vec::new()),
        }
    }
}

pub(super) fn snapshot_queue_state(inner: &Inner) -> QueueState {
    use std::collections::HashMap;

    let state = inner.state.lock().expect("engine state poisoned");

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

pub(super) fn notify_queue_listeners(inner: &Inner) {
    let snapshot = snapshot_queue_state(inner);
    {
        let state = inner.state.lock().expect("engine state poisoned");
        if state.settings.queue_persistence_mode == QueuePersistenceMode::CrashRecovery {
            persist_queue_state(&snapshot);
        }
    }
    let listeners = inner
        .queue_listeners
        .lock()
        .expect("queue listeners lock poisoned");
    for listener in listeners.iter() {
        listener(snapshot.clone());
    }
}

pub(super) fn queue_state_sidecar_path() -> Option<PathBuf> {
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

/// Persist the given snapshot to disk using a debounced writer. The first
/// snapshot is written immediately; subsequent snapshots within the debounce
/// window are coalesced so that at most one write occurs per window while
/// still keeping a recent snapshot durable.
pub(super) fn persist_queue_state(snapshot: &QueueState) {
    let mut state = QUEUE_PERSIST_STATE
        .lock()
        .expect("queue persist state lock poisoned");

    let now = Instant::now();
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
            if now.duration_since(last) >= debounce {
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
    {
        let state = inner.state.lock().expect("engine state poisoned");
        if !state.jobs.is_empty() || !state.queue.is_empty() {
            // Do not clobber any in-memory jobs that were already enqueued by
            // this process; recovery is only applied on a fresh engine.
            return;
        }
    }

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
        inner
            .next_job_id
            .store(max_numeric_id + 1, std::sync::atomic::Ordering::SeqCst);
    }

    let mut waiting: Vec<(u64, String)> = Vec::new();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        for mut job in snapshot.jobs {
            let id = job.id.clone();

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
            if matches!(job.job_type, JobType::Video)
                && matches!(
                    job.status,
                    JobStatus::Waiting | JobStatus::Queued | JobStatus::Paused
                )
                && job.wait_metadata.is_none()
            {
                let tmp_output = build_video_tmp_output_path(Path::new(&job.filename));
                if tmp_output.exists() {
                    job.wait_metadata = Some(WaitMetadata {
                        last_progress_percent: Some(job.progress),
                        processed_seconds: None,
                        tmp_output_path: Some(tmp_output.to_string_lossy().into_owned()),
                    });
                }
            }

            if matches!(job.status, JobStatus::Waiting | JobStatus::Queued) {
                let order = persisted_order.unwrap_or(u64::MAX);
                waiting.push((order, id.clone()));
            }

            state.jobs.insert(id, job);
        }

        waiting.sort_by(|(ao, aid), (bo, bid)| ao.cmp(bo).then(aid.cmp(bid)));

        for (_order, id) in waiting.drain(..) {
            if !state.queue.contains(&id) {
                state.queue.push_back(id);
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
