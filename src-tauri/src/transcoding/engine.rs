use std::collections::{hash_map::DefaultHasher, HashMap, HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use crate::transcoding::domain::{
    AutoCompressProgress, AutoCompressResult, JobSource, JobStatus, JobType, MediaInfo,
    QueueState, SmartScanConfig, TranscodeJob, WaitMetadata,
};
use crate::transcoding::monitor::{
    sample_cpu_usage, sample_gpu_usage, CpuUsageSnapshot, GpuUsageSnapshot,
};
use crate::transcoding::settings::{
    self, AppSettings, DownloadedToolInfo, DownloadedToolState, DEFAULT_PROGRESS_UPDATE_INTERVAL_MS,
};
use crate::transcoding::tools::{
    ensure_tool_available, last_tool_download_metadata, tool_status, ExternalToolKind,
    ExternalToolStatus,
};

// Emit Smart Scan progress snapshots at a coarse granularity so large
// directory trees do not overwhelm the event stream.
const SMART_SCAN_PROGRESS_EVERY: u64 = 32;

// Ensure external tools (ffmpeg, ffprobe, avifenc) do not pop up a visible
// console window when spawned from the GUI on Windows. No-op elsewhere.
#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}

use super::domain::FFmpegPreset;

type QueueListener = Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
type SmartScanProgressListener = Arc<dyn Fn(AutoCompressProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SmartScanBatchStatus {
    Scanning,
    Running,
    Completed,
    #[allow(dead_code)]
    Failed,
}

#[derive(Debug, Clone)]
struct SmartScanBatch {
    batch_id: String,
    root_path: String,
    status: SmartScanBatchStatus,
    total_files_scanned: u64,
    total_candidates: u64,
    total_processed: u64,
    child_job_ids: Vec<String>,
    #[allow(dead_code)]
    started_at_ms: u64,
    completed_at_ms: Option<u64>,
}

struct EngineState {
    presets: Vec<FFmpegPreset>,
    settings: AppSettings,
    jobs: HashMap<String, TranscodeJob>,
    queue: VecDeque<String>,
    active_job: Option<String>,
    cancelled_jobs: HashSet<String>,
    // Jobs that have been asked to enter a "wait" state from the frontend.
    // The worker loop observes this and cooperatively pauses the job.
    wait_requests: HashSet<String>,
    // Jobs that should be restarted from 0% after their current run
    // terminates (for example via cooperative cancellation).
    restart_requests: HashSet<String>,
    // Per-input media metadata cache keyed by absolute input path. This avoids
    // repeated ffprobe calls when the same file is reused across jobs.
    media_info_cache: HashMap<String, MediaInfo>,
    // Smart Scan batches tracked by stable batch id so the frontend can build
    // composite cards from queue + progress events alone.
    smart_scan_batches: HashMap<String, SmartScanBatch>,
    // Known Smart Scan output paths (both from current and previous runs).
    // These are used to avoid overwriting existing outputs and to skip
    // re-enqueuing Smart Scan outputs as new candidates.
    known_smart_scan_outputs: HashSet<String>,
}

impl EngineState {
    fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
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

struct Inner {
    state: Mutex<EngineState>,
    cv: Condvar,
    next_job_id: AtomicU64,
    queue_listeners: Mutex<Vec<QueueListener>>,
    smart_scan_listeners: Mutex<Vec<SmartScanProgressListener>>,
}

impl Inner {
    fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
        Self {
            state: Mutex::new(EngineState::new(presets, settings)),
            cv: Condvar::new(),
            next_job_id: AtomicU64::new(1),
            queue_listeners: Mutex::new(Vec::new()),
            smart_scan_listeners: Mutex::new(Vec::new()),
        }
    }
}

#[derive(Clone)]
pub struct TranscodingEngine {
    inner: Arc<Inner>,
}

fn snapshot_queue_state(inner: &Inner) -> QueueState {
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

fn notify_queue_listeners(inner: &Inner) {
    let snapshot = snapshot_queue_state(inner);
    let listeners = inner
        .queue_listeners
        .lock()
        .expect("queue listeners lock poisoned");
    for listener in listeners.iter() {
        listener(snapshot.clone());
    }
}

fn notify_smart_scan_listeners(inner: &Inner, progress: AutoCompressProgress) {
    let listeners = inner
        .smart_scan_listeners
        .lock()
        .expect("smart scan listeners lock poisoned");
    for listener in listeners.iter() {
        listener(progress.clone());
    }
}

fn update_smart_scan_batch_with_inner<F>(inner: &Inner, batch_id: &str, force_notify: bool, f: F)
where
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

fn register_known_smart_scan_output_with_inner(inner: &Inner, path: &Path) {
    let key = path.to_string_lossy().into_owned();
    let mut state = inner.state.lock().expect("engine state poisoned");
    state.known_smart_scan_outputs.insert(key);
}

fn is_known_smart_scan_output_with_inner(inner: &Inner, path: &Path) -> bool {
    let key = path.to_string_lossy().into_owned();
    let state = inner.state.lock().expect("engine state poisoned");
    state.known_smart_scan_outputs.contains(&key)
}

impl TranscodingEngine {
    pub fn new() -> Result<Self> {
        let presets = settings::load_presets().unwrap_or_default();
        let settings = settings::load_settings().unwrap_or_default();
        let inner = Arc::new(Inner::new(presets, settings));
        Self::spawn_worker(inner.clone());
        Ok(Self { inner })
    }

    fn next_job_id(&self) -> String {
        self.inner
            .next_job_id
            .fetch_add(1, Ordering::SeqCst)
            .to_string()
    }

    pub fn queue_state(&self) -> QueueState {
        snapshot_queue_state(&self.inner)
    }

    pub fn register_queue_listener<F>(&self, listener: F)
    where
        F: Fn(QueueState) + Send + Sync + 'static,
    {
        let mut listeners = self
            .inner
            .queue_listeners
            .lock()
            .expect("queue listeners lock poisoned");
        listeners.push(Arc::new(listener));
    }

    pub fn register_smart_scan_listener<F>(&self, listener: F)
    where
        F: Fn(AutoCompressProgress) + Send + Sync + 'static,
    {
        let mut listeners = self
            .inner
            .smart_scan_listeners
            .lock()
            .expect("smart scan listeners lock poisoned");
        listeners.push(Arc::new(listener));
    }

    fn notify_listeners(&self) {
        notify_queue_listeners(&self.inner);
    }

    pub fn presets(&self) -> Vec<FFmpegPreset> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.clone()
    }

    pub fn save_preset(&self, preset: FFmpegPreset) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        if let Some(existing) = state.presets.iter_mut().find(|p| p.id == preset.id) {
            *existing = preset;
        } else {
            state.presets.push(preset);
        }
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    pub fn delete_preset(&self, preset_id: &str) -> Result<Vec<FFmpegPreset>> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.presets.retain(|p| p.id != preset_id);
        settings::save_presets(&state.presets)?;
        Ok(state.presets.clone())
    }

    pub fn settings(&self) -> AppSettings {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    }

    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.settings = new_settings.clone();
        settings::save_settings(&state.settings)?;
        Ok(new_settings)
    }

    fn record_tool_download(&self, kind: ExternalToolKind, binary_path: &str) {
        record_tool_download_with_inner(&self.inner, kind, binary_path);
    }

    pub fn enqueue_transcode_job(
        &self,
        filename: String,
        job_type: JobType,
        source: JobSource,
        original_size_mb: f64,
        original_codec: Option<String>,
        preset_id: String,
    ) -> TranscodeJob {
        let id = self.next_job_id();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let input_path = filename.clone();

        // Prefer a backend-derived size based on the actual file on disk; fall back
        // to the caller-provided value if metadata is unavailable.
        let computed_original_size_mb = fs::metadata(&filename)
            .map(|m| m.len() as f64 / (1024.0 * 1024.0))
            .unwrap_or(original_size_mb);

        let output_path = if matches!(job_type, JobType::Video) {
            let path = PathBuf::from(&filename);
            Some(
                build_video_output_path(&path)
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        };

        let codec_for_job = original_codec.clone();

        let job = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let estimated_seconds = state
                .presets
                .iter()
                .find(|p| p.id == preset_id)
                .and_then(|p| estimate_job_seconds_for_preset(computed_original_size_mb, p));
            let job = TranscodeJob {
                id: id.clone(),
                filename,
                job_type,
                source,
                queue_order: None,
                original_size_mb: computed_original_size_mb,
                original_codec: codec_for_job,
                preset_id,
                status: JobStatus::Waiting,
                progress: 0.0,
                start_time: Some(now_ms),
                end_time: None,
                output_size_mb: None,
                logs: Vec::new(),
                skip_reason: None,
                input_path: Some(input_path),
                output_path,
                ffmpeg_command: None,
                media_info: Some(MediaInfo {
                    duration_seconds: None,
                    width: None,
                    height: None,
                    frame_rate: None,
                    video_codec: original_codec,
                    audio_codec: None,
                    size_mb: Some(computed_original_size_mb),
                }),
                estimated_seconds,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                batch_id: None,
                 wait_metadata: None,
            };
            state.queue.push_back(id.clone());
            state.jobs.insert(id.clone(), job.clone());
            job
        };
        self.inner.cv.notify_one();
        self.notify_listeners();
        job
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        let mut should_notify = false;

        let result = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let status = match state.jobs.get(job_id) {
                Some(job) => job.status.clone(),
                None => return false,
            };

            match status {
                JobStatus::Waiting | JobStatus::Queued => {
                    // Remove from queue and mark as cancelled without ever starting ffmpeg.
                    state.queue.retain(|id| id != job_id);
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        job.status = JobStatus::Cancelled;
                        job.progress = 0.0;
                        job.end_time = Some(current_time_millis());
                        job.logs.push("Cancelled before start".to_string());
                        recompute_log_tail(job);
                    }
                    should_notify = true;
                    true
                }
                JobStatus::Processing => {
                    // Mark for cooperative cancellation; the worker thread will
                    // observe this and terminate the underlying ffmpeg process.
                    state.cancelled_jobs.insert(job_id.to_string());
                    should_notify = true;
                    true
                }
                _ => false,
            }
        };

        if should_notify {
            self.notify_listeners();
        }

        result
    }

    /// Request that a running job transition into a "wait" state, releasing
    /// its worker slot while preserving progress. The actual state change is
    /// performed cooperatively inside the worker loop.
    pub fn wait_job(&self, job_id: &str) -> bool {
        let mut should_notify = false;

        let result = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let status = match state.jobs.get(job_id) {
                Some(job) => job.status.clone(),
                None => return false,
            };

            match status {
                JobStatus::Processing => {
                    state.wait_requests.insert(job_id.to_string());
                    should_notify = true;
                    true
                }
                _ => false,
            }
        };

        if should_notify {
            self.notify_listeners();
        }

        result
    }

    /// Resume a previously paused (waited) job by placing it back into the
    /// waiting queue. The job keeps its existing progress and wait metadata.
    pub fn resume_job(&self, job_id: &str) -> bool {
        let mut should_notify = false;

        let result = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let job = match state.jobs.get_mut(job_id) {
                Some(job) => job,
                None => return false,
            };

            match job.status {
                JobStatus::Paused => {
                    job.status = JobStatus::Waiting;
                    if !state.queue.iter().any(|id| id == job_id) {
                        state.queue.push_back(job_id.to_string());
                    }
                    should_notify = true;
                    true
                }
                _ => false,
            }
        };

        if should_notify {
            self.inner.cv.notify_one();
            self.notify_listeners();
        }

        result
    }

    /// Restart a job from 0% progress. For jobs that are currently processing
    /// this schedules a cooperative cancellation followed by a fresh enqueue
    /// in `mark_job_cancelled`. For non-processing jobs the state is reset
    /// immediately and the job is reinserted into the waiting queue.
    pub fn restart_job(&self, job_id: &str) -> bool {
        let mut should_notify = false;

        let result = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let job = match state.jobs.get_mut(job_id) {
                Some(job) => job,
                None => return false,
            };

            match job.status {
                JobStatus::Completed | JobStatus::Skipped => false,
                JobStatus::Processing => {
                    state.restart_requests.insert(job_id.to_string());
                    state.cancelled_jobs.insert(job_id.to_string());
                    should_notify = true;
                    true
                }
                _ => {
                    // Reset immediately for non-processing jobs.
                    job.status = JobStatus::Waiting;
                    job.progress = 0.0;
                    job.end_time = None;
                    job.failure_reason = None;
                    job.skip_reason = None;
                    job.wait_metadata = None;
                    job.logs
                        .push("Restart requested from UI; job will re-run from 0%".to_string());
                    recompute_log_tail(job);

                    if !state.queue.iter().any(|id| id == job_id) {
                        state.queue.push_back(job_id.to_string());
                    }

                    should_notify = true;
                    // Any old restart or cancel flags become irrelevant.
                    state.restart_requests.remove(job_id);
                    state.cancelled_jobs.remove(job_id);
                    true
                }
            }
        };

        if should_notify {
            self.inner.cv.notify_one();
            self.notify_listeners();
        }

        result
    }

    /// Reorder the waiting queue according to the provided ordered job ids.
    /// Job ids not present in `ordered_ids` keep their relative order at the
    /// tail of the queue so the operation is resilient to partial payloads.
    pub fn reorder_waiting_jobs(&self, ordered_ids: Vec<String>) -> bool {
        let mut should_notify = false;

        {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            if state.queue.is_empty() || ordered_ids.is_empty() {
                return false;
            }

            let ordered_set: HashSet<String> = ordered_ids.iter().cloned().collect();

            // Preserve any ids that are currently in the queue but not covered
            // by the payload so we never "lose" jobs due to a truncated list.
            let mut remaining: VecDeque<String> = state
                .queue
                .iter()
                .filter(|id| !ordered_set.contains(*id))
                .cloned()
                .collect();

            let mut next_queue: VecDeque<String> = VecDeque::new();

            for id in ordered_ids {
                if state.jobs.contains_key(&id) && state.queue.contains(&id) {
                    if !next_queue.contains(&id) {
                        next_queue.push_back(id.clone());
                    }
                }
            }

            // Append any remaining jobs that were not explicitly reordered.
            while let Some(id) = remaining.pop_front() {
                if !next_queue.contains(&id) {
                    next_queue.push_back(id);
                }
            }

            if next_queue != state.queue {
                state.queue = next_queue;
                should_notify = true;
            }
        }

        if should_notify {
            self.notify_listeners();
        }

        should_notify
    }

    pub fn cpu_usage(&self) -> CpuUsageSnapshot {
        sample_cpu_usage()
    }

    pub fn gpu_usage(&self) -> GpuUsageSnapshot {
        sample_gpu_usage()
    }

    pub fn external_tool_statuses(&self) -> Vec<ExternalToolStatus> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        let tools = &state.settings.tools;
        vec![
            tool_status(ExternalToolKind::Ffmpeg, tools),
            tool_status(ExternalToolKind::Ffprobe, tools),
            tool_status(ExternalToolKind::Avifenc, tools),
        ]
    }

    pub fn smart_scan_defaults(&self) -> SmartScanConfig {
        let state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults.clone()
    }

    pub fn update_smart_scan_defaults(&self, config: SmartScanConfig) -> Result<SmartScanConfig> {
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults = config.clone();
        settings::save_settings(&state.settings)?;
        Ok(config)
    }

    pub fn run_auto_compress(
        &self,
        root_path: String,
        config: SmartScanConfig,
    ) -> Result<AutoCompressResult> {
        let root = PathBuf::from(&root_path);
        if !root.exists() {
            return Err(anyhow::anyhow!("Root path does not exist: {root_path}"));
        }

        let (settings_snapshot, presets, batch_id, started_at_ms) = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            state.settings.smart_scan_defaults = config.clone();
            settings::save_settings(&state.settings)?;
            let settings_snapshot = state.settings.clone();
            let presets = state.presets.clone();

            let started_at_ms = current_time_millis();

            let mut hasher = DefaultHasher::new();
            root_path.hash(&mut hasher);
            started_at_ms.hash(&mut hasher);
            let batch_hash = hasher.finish();
            let batch_id = format!("auto-compress-{batch_hash:016x}");

            let batch = SmartScanBatch {
                batch_id: batch_id.clone(),
                root_path: root_path.clone(),
                status: SmartScanBatchStatus::Scanning,
                total_files_scanned: 0,
                total_candidates: 0,
                total_processed: 0,
                child_job_ids: Vec::new(),
                started_at_ms,
                completed_at_ms: None,
            };

            state.smart_scan_batches.insert(batch_id.clone(), batch);

            (settings_snapshot, presets, batch_id, started_at_ms)
        };

        // Emit an initial progress snapshot so the frontend can show that the
        // batch has started even before any files are discovered.
        notify_smart_scan_listeners(
            &self.inner,
            AutoCompressProgress {
                root_path: root_path.clone(),
                total_files_scanned: 0,
                total_candidates: 0,
                total_processed: 0,
                batch_id: batch_id.clone(),
            },
        );

        // Kick off the actual Smart Scan work on a background thread so the
        // Tauri command can return immediately with lightweight batch metadata.
        let engine = self.clone();
        let config_clone = config.clone();
        let batch_id_for_thread = batch_id.clone();
        thread::Builder::new()
            .name(format!("smart-scan-{batch_id_for_thread}"))
            .spawn(move || {
                engine.run_auto_compress_background(
                    root,
                    config_clone,
                    settings_snapshot,
                    presets,
                    batch_id_for_thread,
                );
            })
            .expect("failed to spawn Smart Scan background worker");

        Ok(AutoCompressResult {
            root_path,
            jobs: Vec::new(),
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            batch_id,
            started_at_ms,
            completed_at_ms: 0,
        })
    }

    fn run_auto_compress_background(
        &self,
        root: PathBuf,
        config: SmartScanConfig,
        settings_snapshot: AppSettings,
        presets: Vec<FFmpegPreset>,
        batch_id: String,
    ) {
        // 第一阶段：在任何压缩工作开始之前，对目录结构做一次完整快照。
        // 这样本轮 Smart Scan 过程中生成的输出文件（例如 *.compressed.mp4）
        // 就不会再次被扫描并加入同一批任务，避免“自己压出来的结果又被当成新任务”。
        let mut all_files: Vec<PathBuf> = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(err) => {
                    eprintln!("auto-compress: failed to read dir {}: {err}", dir.display());
                    continue;
                }
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    all_files.push(path);
                }
            }
        }

        // 在正式处理候选输入之前，先将当前目录树中所有“看起来像 Smart Scan 输出”的
        // 文件注册到已知输出集合中，这样后续批次可以可靠地跳过这些路径。
        for path in &all_files {
            if is_smart_scan_style_output(path) {
                register_known_smart_scan_output_with_inner(&self.inner, path);
            }
        }

        // 第二阶段：遍历第一阶段拍下来的文件列表，依次应用 Smart Scan 规则。
        // 本轮新生成的输出文件不在 all_files 中，因此不会被重新加入同一批任务。
        for path in all_files {
            // 所有文件都计入扫描计数，但已知 Smart Scan 输出不会再次作为候选输入。
            update_smart_scan_batch_with_inner(&self.inner, &batch_id, false, |batch| {
                batch.total_files_scanned = batch.total_files_scanned.saturating_add(1);
            });

            if is_known_smart_scan_output_with_inner(&self.inner, &path)
                || is_smart_scan_style_output(&path)
            {
                // 已知输出：仅计入扫描，不作为候选。
                continue;
            }

            if is_image_file(&path) {
                // 图像仍由后台线程同步处理，但整个流程在 Smart Scan 专用线程中，
                // 不再阻塞 Tauri 命令线程。
                match self.handle_image_file(&path, &config, &settings_snapshot, &batch_id) {
                    Ok(job) => {
                        // 将图像任务注册到队列状态中，使其成为队列事件的一部分。
                        {
                            let mut state = self.inner.state.lock().expect("engine state poisoned");
                            state.jobs.insert(job.id.clone(), job.clone());
                        }

                        let is_terminal = matches!(
                            job.status,
                            JobStatus::Completed | JobStatus::Skipped | JobStatus::Failed
                        );

                        // 每个图像候选都立即视为“已处理”：压缩逻辑在当前线程同步完成。
                        update_smart_scan_batch_with_inner(&self.inner, &batch_id, true, |batch| {
                            batch.total_candidates = batch.total_candidates.saturating_add(1);
                            batch.child_job_ids.push(job.id.clone());
                            if is_terminal {
                                batch.total_processed = batch.total_processed.saturating_add(1);
                            }
                        });

                        // 图像输出成功生成时，记录为已知输出，避免后续批次重新压缩。
                        if let Some(ref output_path) = job.output_path {
                            let output = PathBuf::from(output_path);
                            if matches!(job.status, JobStatus::Completed) {
                                register_known_smart_scan_output_with_inner(&self.inner, &output);
                            }
                        }

                        // 通知前端队列状态发生了变化。
                        self.notify_listeners();
                    }
                    Err(err) => {
                        eprintln!(
                            "auto-compress: failed to handle image file {}: {err:#}",
                            path.display()
                        );
                    }
                }
            } else if is_video_file(&path) {
                let preset = presets
                    .iter()
                    .find(|p| p.id == config.video_preset_id)
                    .cloned();

                if let Some(preset) = preset {
                    let job = self.enqueue_smart_scan_video_job(
                        &path,
                        &config,
                        &settings_snapshot,
                        &preset,
                        &batch_id,
                    );

                    update_smart_scan_batch_with_inner(&self.inner, &batch_id, true, |batch| {
                        batch.total_candidates = batch.total_candidates.saturating_add(1);
                        batch.child_job_ids.push(job.id.clone());

                        let is_terminal = matches!(
                            job.status,
                            JobStatus::Completed
                                | JobStatus::Skipped
                                | JobStatus::Failed
                                | JobStatus::Cancelled
                        );
                        if is_terminal {
                            batch.total_processed = batch.total_processed.saturating_add(1);
                        } else if matches!(batch.status, SmartScanBatchStatus::Scanning) {
                            // 当存在至少一个真实入队的候选时，将批次标记为 Running。
                            batch.status = SmartScanBatchStatus::Running;
                        }
                    });
                } else {
                    // 当没有匹配的预设时，仍然增加 candidates 计数，并立刻将该“任务”视为已处理。
                    update_smart_scan_batch_with_inner(&self.inner, &batch_id, true, |batch| {
                        batch.total_candidates = batch.total_candidates.saturating_add(1);
                        batch.total_processed = batch.total_processed.saturating_add(1);
                    });
                }
            }
        }

        // 扫描阶段结束后，如果没有任何候选，则批次立即视为完成。
        update_smart_scan_batch_with_inner(&self.inner, &batch_id, true, |batch| {
            if batch.total_candidates == 0 {
                batch.status = SmartScanBatchStatus::Completed;
                batch.completed_at_ms = Some(current_time_millis());
            } else if matches!(batch.status, SmartScanBatchStatus::Scanning) {
                batch.status = SmartScanBatchStatus::Running;
            }
        });
    }

    fn enqueue_smart_scan_video_job(
        &self,
        path: &Path,
        config: &SmartScanConfig,
        settings: &AppSettings,
        preset: &FFmpegPreset,
        batch_id: &str,
    ) -> TranscodeJob {
        let original_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

        let filename = path.to_string_lossy().into_owned();
        let input_path = filename.clone();

        let id = self.next_job_id();
        let now_ms = current_time_millis();

        let mut job = TranscodeJob {
            id: id.clone(),
            filename,
            job_type: JobType::Video,
            source: JobSource::SmartScan,
            queue_order: None,
            original_size_mb,
            original_codec: None,
            preset_id: preset.id.clone(),
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: Some(now_ms),
            end_time: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some(input_path.clone()),
            output_path: None,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: Some(original_size_mb),
            }),
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: Some(batch_id.to_string()),
            wait_metadata: None,
        };

        // 根据体积与编解码预先过滤掉明显不值得压缩的文件。
        if original_size_mb < config.min_video_size_mb as f64 {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.end_time = Some(now_ms);
            job.skip_reason = Some(format!("Size < {}MB", config.min_video_size_mb));

            let mut state = self.inner.state.lock().expect("engine state poisoned");
            state.jobs.insert(id, job.clone());
            drop(state);

            self.notify_listeners();
            return job;
        }

        if let Ok(codec) = detect_video_codec(path, settings) {
            job.original_codec = Some(codec.clone());
            if let Some(info) = job.media_info.as_mut() {
                info.video_codec = Some(codec.clone());
            }
            let lower = codec.to_ascii_lowercase();
            if matches!(lower.as_str(), "hevc" | "hevc_nvenc" | "h265" | "av1") {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.end_time = Some(now_ms);
                job.skip_reason = Some(format!("Codec is already {codec}"));

                let mut state = self.inner.state.lock().expect("engine state poisoned");
                state.jobs.insert(id, job.clone());
                drop(state);

                self.notify_listeners();
                return job;
            }
        }

        // 为 Smart Scan 视频任务选择一个不会覆盖现有文件的输出路径，并记录到已知输出集合中。
        let mut state = self.inner.state.lock().expect("engine state poisoned");
        let output_path = reserve_unique_smart_scan_video_output_path(&mut state, path);

        job.output_path = Some(output_path.to_string_lossy().into_owned());
        job.estimated_seconds = estimate_job_seconds_for_preset(original_size_mb, preset);

        state.queue.push_back(id.clone());
        state.jobs.insert(id.clone(), job.clone());
        drop(state);

        self.inner.cv.notify_one();
        self.notify_listeners();

        job
    }

    #[allow(dead_code)]
    pub fn smart_scan_batch_summary(&self, batch_id: &str) -> Option<AutoCompressResult> {
        let state = self.inner.state.lock().expect("engine state poisoned");
        let batch = state.smart_scan_batches.get(batch_id)?.clone();

        let mut jobs = Vec::new();
        for job in state.jobs.values() {
            if job.batch_id.as_deref() == Some(batch_id) {
                jobs.push(job.clone());
            }
        }

        Some(AutoCompressResult {
            root_path: batch.root_path,
            jobs,
            total_files_scanned: batch.total_files_scanned,
            total_candidates: batch.total_candidates,
            total_processed: batch.total_processed,
            batch_id: batch.batch_id,
            started_at_ms: batch.started_at_ms,
            completed_at_ms: batch.completed_at_ms.unwrap_or(batch.started_at_ms),
        })
    }

    pub fn inspect_media(&self, path: String) -> Result<String> {
        let settings_snapshot = {
            let state = self.inner.state.lock().expect("engine state poisoned");
            state.settings.clone()
        };

        let (ffprobe_path, _source, did_download) =
            ensure_tool_available(ExternalToolKind::Ffprobe, &settings_snapshot.tools)?;

        if did_download {
            self.record_tool_download(ExternalToolKind::Ffprobe, &ffprobe_path);
        }

        let mut cmd = Command::new(&ffprobe_path);
        configure_background_command(&mut cmd);
        let output = cmd
            .arg("-v")
            .arg("quiet")
            .arg("-print_format")
            .arg("json")
            .arg("-show_format")
            .arg("format_tags=title,artist,album,encoder")
            .arg("-show_streams")
            .arg(&path)
            .output()
            .with_context(|| format!("failed to run ffprobe on {path}"))?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "ffprobe failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn record_tool_download_with_inner(inner: &Inner, kind: ExternalToolKind, binary_path: &str) {
    if let Some((url, version, tag)) = last_tool_download_metadata(kind) {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let settings_ref = &mut state.settings;
        let tools = &mut settings_ref.tools;

        let downloaded = tools
            .downloaded
            .get_or_insert_with(DownloadedToolState::default);

        let info = DownloadedToolInfo {
            version: version.clone(),
            tag: tag.clone(),
            source_url: Some(url.clone()),
            downloaded_at: Some(current_time_millis()),
        };

        match kind {
            ExternalToolKind::Ffmpeg => {
                downloaded.ffmpeg = Some(info);
                // Prefer the auto-downloaded binary for future invocations.
                tools.ffmpeg_path = Some(binary_path.to_string());
            }
            ExternalToolKind::Ffprobe => {
                downloaded.ffprobe = Some(info);
                tools.ffprobe_path = Some(binary_path.to_string());
            }
            ExternalToolKind::Avifenc => {
                downloaded.avifenc = Some(info);
                tools.avifenc_path = Some(binary_path.to_string());
            }
        }

        if let Err(err) = settings::save_settings(settings_ref) {
            eprintln!(
                "failed to persist external tool download metadata to settings.json: {err:#}"
            );
        }
    }
}

fn mark_smart_scan_child_processed(inner: &Inner, job_id: &str) {
    let batch_id_opt = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return,
        };

        let batch_id = match job.batch_id.clone() {
            Some(id) => id,
            None => return,
        };

        let batch = match state.smart_scan_batches.get_mut(&batch_id) {
            Some(b) => b,
            None => return,
        };

        // 仅在作业进入终态时增加 processed 计数。
        if !matches!(
            job.status,
            JobStatus::Completed | JobStatus::Skipped | JobStatus::Failed | JobStatus::Cancelled
        ) {
            return;
        }

        batch.total_processed = batch.total_processed.saturating_add(1);
        if batch.total_processed >= batch.total_candidates
            && !matches!(
                batch.status,
                SmartScanBatchStatus::Completed | SmartScanBatchStatus::Failed
            )
        {
            batch.status = SmartScanBatchStatus::Completed;
            if batch.completed_at_ms.is_none() {
                batch.completed_at_ms = Some(current_time_millis());
            }
        }

        Some(batch_id)
    };

    if let Some(batch_id) = batch_id_opt {
        // 进度与状态已在上方锁内更新，这里仅负责广播最新快照。
        update_smart_scan_batch_with_inner(inner, &batch_id, true, |_batch| {});
    }
}

impl TranscodingEngine {
    fn spawn_worker(inner: Arc<Inner>) {
        // Determine a bounded worker count based on available logical cores
        // and, when configured, the user-specified concurrency limit. This
        // keeps behaviour predictable while still letting power users cap
        // resource usage explicitly from the settings panel.
        let logical_cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .max(1);

        let configured_max = {
            let state = inner.state.lock().expect("engine state poisoned");
            state.settings.max_parallel_jobs.unwrap_or(0)
        };

        let auto_workers = if logical_cores >= 4 {
            std::cmp::max(2, logical_cores / 2)
        } else {
            1
        };

        let worker_count = if configured_max == 0 {
            auto_workers
        } else {
            let max = configured_max as usize;
            // Clamp into [1, logical_cores] so we never oversubscribe the CPU.
            max.clamp(1, logical_cores)
        };

        for index in 0..worker_count {
            let inner_clone = inner.clone();
            thread::Builder::new()
                .name(format!("transcoding-worker-{index}"))
                .spawn(move || worker_loop(inner_clone))
                .expect("failed to spawn transcoding worker thread");
        }
    }
}

/// Pop the next job id from the queue and mark it as processing under the
/// engine state lock. This helper is used both by the real worker threads and
/// by tests that need to reason about multi-worker scheduling behaviour.
fn next_job_for_worker_locked(state: &mut EngineState) -> Option<String> {
    let job_id = state.queue.pop_front()?;
    state.active_job = Some(job_id.clone());

    if let Some(job) = state.jobs.get_mut(&job_id) {
        job.status = JobStatus::Processing;
        if job.start_time.is_none() {
            job.start_time = Some(current_time_millis());
        }
        job.progress = 0.0;
    }

    Some(job_id)
}

fn worker_loop(inner: Arc<Inner>) {
    loop {
        let job_id = {
            let mut state = inner.state.lock().expect("engine state poisoned");
            while state.queue.is_empty() {
                state = inner.cv.wait(state).expect("engine state poisoned");
            }

            match next_job_for_worker_locked(&mut state) {
                Some(id) => id,
                None => continue,
            }
        };

        // Notify listeners that a job has moved into processing state.
        notify_queue_listeners(&inner);

        if let Err(err) = process_transcode_job(&inner, &job_id) {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("Transcode failed: {err:#}");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(&inner, &job_id);
        }

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.active_job = None;
            state.cancelled_jobs.remove(&job_id);
        }

        // Broadcast final state for the completed / failed / skipped job.
        notify_queue_listeners(&inner);
    }
}

fn process_transcode_job(inner: &Inner, job_id: &str) -> Result<()> {
    let (
        input_path,
        preset,
        settings_snapshot,
        original_size_bytes,
        job_type,
        preset_id,
        cached_media_info,
        job_filename,
    ) = {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return Ok(()),
        };

        let preset = state
            .presets
            .iter()
            .find(|p| p.id == job.preset_id)
            .cloned();
        let original_size_bytes = fs::metadata(&job.filename).map(|m| m.len()).unwrap_or(0);
        let cached_media_info = state.media_info_cache.get(&job.filename).cloned();

        (
            PathBuf::from(&job.filename),
            preset,
            state.settings.clone(),
            original_size_bytes,
            job.job_type.clone(),
            job.preset_id.clone(),
            cached_media_info,
            job.filename.clone(),
        )
    };

    if job_type != JobType::Video {
        // For now, only video jobs are processed by the background worker.
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                job.skip_reason =
                    Some("Only video jobs are processed by the ffmpeg worker".to_string());
            }
        }
        mark_smart_scan_child_processed(inner, job_id);
        return Ok(());
    }

    let preset = match preset {
        Some(p) => p,
        None => {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("No preset found for preset id '{preset_id}'");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(inner, job_id);
            return Ok(());
        }
    };

    // Ensure ffmpeg is available, honoring auto-download / update settings.
    // `ffmpeg_source` is used to decide whether it is safe to enable newer
    // CLI flags such as `-stats_period` which are guaranteed to exist on the
    // auto-downloaded static builds we ship, but may not be present on very
    // old custom ffmpeg binaries provided by the user.
    let (ffmpeg_path, ffmpeg_source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings_snapshot.tools)?;

    if did_download {
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.logs.push(format!(
                    "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
                ));
                recompute_log_tail(job);
            }
        }
        // Persist metadata for the newly downloaded ffmpeg binary.
        record_tool_download_with_inner(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

    // Build or reuse cached media metadata for the input so the UI can show
    // duration/codec/size without repeated ffprobe calls for the same file.
    let mut media_info = cached_media_info.unwrap_or(MediaInfo {
        duration_seconds: None,
        width: None,
        height: None,
        frame_rate: None,
        video_codec: None,
        audio_codec: None,
        size_mb: if original_size_bytes > 0 {
            Some(original_size_bytes as f64 / (1024.0 * 1024.0))
        } else {
            None
        },
    });

    if media_info.duration_seconds.is_none() {
        if let Ok(d) = detect_duration_seconds(&input_path, &settings_snapshot) {
            media_info.duration_seconds = Some(d);
        }
    }

    if media_info.video_codec.is_none() {
        if let Ok(codec) = detect_video_codec(&input_path, &settings_snapshot) {
            media_info.video_codec = Some(codec);
        }
    }

    if media_info.width.is_none() || media_info.height.is_none() || media_info.frame_rate.is_none()
    {
        if let Ok((width, height, frame_rate)) =
            detect_video_dimensions_and_frame_rate(&input_path, &settings_snapshot)
        {
            if media_info.width.is_none() {
                media_info.width = width;
            }
            if media_info.height.is_none() {
                media_info.height = height;
            }
            if media_info.frame_rate.is_none() {
                media_info.frame_rate = frame_rate;
            }
        }
    }

    let output_path = {
        // Prefer a job-specific output path when provided (for example from
        // Smart Scan), falling back to the deterministic helper for older
        // manual jobs.
        let state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get(job_id) {
            if let Some(ref out) = job.output_path {
                PathBuf::from(out)
            } else {
                build_video_output_path(&input_path)
            }
        } else {
            build_video_output_path(&input_path)
        }
    };
    let tmp_output = build_video_tmp_output_path(&input_path);
    // Prefer duration from ffprobe when available, but allow the ffmpeg
    // stderr metadata lines (e.g. "Duration: 00:01:29.95, ...") to fill this
    // in later if ffprobe is missing or fails on the current file.
    let mut total_duration = media_info.duration_seconds;
    let preview_path = generate_preview_for_video(
        &input_path,
        &ffmpeg_path,
        total_duration,
        settings_snapshot.preview_capture_percent,
    );

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.input_path = Some(input_path.to_string_lossy().into_owned());
            job.output_path = Some(output_path.to_string_lossy().into_owned());
            job.media_info = Some(media_info.clone());
            if let Some(preview) = &preview_path {
                job.preview_path = Some(preview.to_string_lossy().into_owned());
            }
            state
                .media_info_cache
                .insert(job_filename, media_info.clone());
        }
    }

    // Broadcast an updated queue snapshot with media metadata and preview path
    // before starting the heavy ffmpeg transcode so the UI can show thumbnails
    // and basic info as soon as a job enters Processing.
    notify_queue_listeners(inner);

    let args = build_ffmpeg_args(&preset, &input_path, &tmp_output);

    // Record the exact ffmpeg command we are about to run so that users can
    // see and reproduce it from the queue UI if anything goes wrong.
    let ffmpeg_program_for_log = ffmpeg_path.clone();
    log_external_command(inner, job_id, &ffmpeg_program_for_log, &args);

    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    // Increase structured progress update frequency for the bundled ffmpeg
    // binary so `job.progress` has a higher reporting rate without inventing
    // synthetic percentages. Old custom ffmpeg builds may not support this
    // flag, so we only apply it for the known static download source.
    if ffmpeg_source == "download" {
        let interval_ms = settings_snapshot
            .progress_update_interval_ms
            .unwrap_or(DEFAULT_PROGRESS_UPDATE_INTERVAL_MS);
        // Clamp into a sensible range [50ms, 2000ms] to avoid extreme values.
        let clamped_ms = interval_ms.clamp(50, 2000) as f64;
        let stats_period_secs = clamped_ms / 1000.0;
        cmd.arg("-stats_period")
            .arg(format!("{stats_period_secs:.3}"));
    }
    let mut child = cmd
        .args(&args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg for {}", input_path.display()))?;

    let start_time = SystemTime::now();

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            // Cooperative wait/cancel handling: if the frontend has requested
            // a wait or cancel for this job, terminate the ffmpeg child
            // process and transition the job into the appropriate state.
            if is_job_wait_requested(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_waiting(inner, job_id, &tmp_output, &output_path, total_duration)?;
                return Ok(());
            }

            if is_job_cancelled(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_cancelled(inner, job_id)?;
                let _ = fs::remove_file(&tmp_output);
                return Ok(());
            }

            if is_job_cancelled(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_cancelled(inner, job_id)?;
                let _ = fs::remove_file(&tmp_output);
                return Ok(());
            }

            // When ffprobe is unavailable or fails, infer total duration from
            // ffmpeg's own metadata header line ("Duration: HH:MM:SS.xx,...")
            // so that the UI progress bar still advances instead of staying
            // stuck at 0% until completion.
            if total_duration.is_none() {
                if let Some(d) = parse_ffmpeg_duration_from_metadata_line(&line) {
                    if d > 0.0 {
                        total_duration = Some(d);

                        // Also update the job's cached media info so future
                        // queue_state snapshots and the inspection UI can see
                        // an accurate duration value.
                        let mut state = inner.state.lock().expect("engine state poisoned");
                        if let Some(job) = state.jobs.get_mut(job_id) {
                            if let Some(info) = job.media_info.as_mut() {
                                info.duration_seconds = Some(d);
                            } else {
                                job.media_info = Some(MediaInfo {
                                    duration_seconds: Some(d),
                                    width: None,
                                    height: None,
                                    frame_rate: None,
                                    video_codec: None,
                                    audio_codec: None,
                                    size_mb: None,
                                });
                            }
                            let key = job.filename.clone();
                            if let Some(info) = job.media_info.clone() {
                                state.media_info_cache.insert(key, info);
                            }
                        }
                        drop(state);
                    }
                }
            }

            if let Some((elapsed, speed)) = parse_ffmpeg_progress_line(&line) {
                // If ffmpeg reports an elapsed time that is slightly longer than
                // our current duration estimate, treat this as the new effective
                // duration. This keeps the progress bar moving smoothly instead
                // of stalling near the end when ffprobe underestimates length.
                if let Some(total) = total_duration {
                    if elapsed.is_finite() && total.is_finite() && elapsed > total * 1.01 {
                        total_duration = Some(elapsed);

                        // Also update the job's cached media info so future
                        // queue_state snapshots and the inspection UI can see
                        // the refined duration value.
                        let mut state = inner.state.lock().expect("engine state poisoned");
                        if let Some(job) = state.jobs.get_mut(job_id) {
                            if let Some(info) = job.media_info.as_mut() {
                                info.duration_seconds = Some(elapsed);
                            } else {
                                job.media_info = Some(MediaInfo {
                                    duration_seconds: Some(elapsed),
                                    width: None,
                                    height: None,
                                    frame_rate: None,
                                    video_codec: None,
                                    audio_codec: None,
                                    size_mb: None,
                                });
                            }
                            let key = job.filename.clone();
                            if let Some(info) = job.media_info.clone() {
                                state.media_info_cache.insert(key, info);
                            }
                        }
                        drop(state);
                    }
                }

                let mut percent = compute_progress_percent(total_duration, elapsed);
                if percent >= 100.0 {
                    // Keep a tiny numerical headroom so that the last step to
                    // an exact 100% always comes from the terminal state
                    // transition (Completed / Failed / Skipped) or an explicit
                    // progress=end marker from ffmpeg, never from an in-flight
                    // stderr sample.
                    percent = 99.9;
                }

                update_job_progress(inner, job_id, Some(percent), Some(&line), speed);
            } else {
                // Non-progress lines are still useful as logs for debugging.
                update_job_progress(inner, job_id, None, Some(&line), None);
            }

            // When `-progress pipe:2` is enabled, ffmpeg emits structured
            // key=value pairs including a `progress=...` marker. Surfacing a
            // final 100% update as soon as we see `progress=end` makes the UI
            // feel truly real-time, while still keeping "100%" reserved for
            // the moment ffmpeg itself declares that all work is done.
            if is_ffmpeg_progress_end(&line) {
                update_job_progress(inner, job_id, Some(100.0), Some(&line), None);
            }
        }
    }

    let status = child.wait()?;

    if is_job_cancelled(inner, job_id) {
        mark_job_cancelled(inner, job_id)?;
        let _ = fs::remove_file(&tmp_output);
        return Ok(());
    }

    if !status.success() {
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Failed;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                let code_desc = match status.code() {
                    Some(code) => format!("exit code {code}"),
                    None => "terminated by signal".to_string(),
                };
                let reason = format!("ffmpeg exited with non-zero status ({code_desc})");
                job.failure_reason = Some(reason.clone());
                job.logs.push(reason);
                recompute_log_tail(job);
            }
        }
        let _ = fs::remove_file(&tmp_output);
        mark_smart_scan_child_processed(inner, job_id);
        return Ok(());
    }

    let elapsed = start_time
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs_f64();

    let new_size_bytes = fs::metadata(&tmp_output).map(|m| m.len()).unwrap_or(0);

    fs::rename(&tmp_output, &output_path).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_output.display(),
            output_path.display()
        )
    })?;

    // 记录所有成功生成的视频输出路径，供 Smart Scan 在后续批次中进行去重与跳过。
    register_known_smart_scan_output_with_inner(inner, &output_path);

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Completed;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            if original_size_bytes > 0 && new_size_bytes > 0 {
                job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
            }
            job.logs.push(format!(
                "Completed in {:.1}s, output size {:.2} MB",
                elapsed,
                job.output_size_mb.unwrap_or(0.0)
            ));
            recompute_log_tail(job);
        }

        // Update preset statistics for completed jobs.
        if original_size_bytes > 0 && new_size_bytes > 0 && elapsed > 0.0 {
            let input_mb = original_size_bytes as f64 / (1024.0 * 1024.0);
            let output_mb = new_size_bytes as f64 / (1024.0 * 1024.0);
            if let Some(preset) = state.presets.iter_mut().find(|p| p.id == preset_id) {
                preset.stats.usage_count += 1;
                preset.stats.total_input_size_mb += input_mb;
                preset.stats.total_output_size_mb += output_mb;
                preset.stats.total_time_seconds += elapsed;
            }
            // Persist updated presets.
            let _ = settings::save_presets(&state.presets);
        }
    }

    mark_smart_scan_child_processed(inner, job_id);

    Ok(())
}

fn is_job_cancelled(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock().expect("engine state poisoned");
    state.cancelled_jobs.contains(job_id)
}

fn is_job_wait_requested(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock().expect("engine state poisoned");
    state.wait_requests.contains(job_id)
}

fn mark_job_waiting(
    inner: &Inner,
    job_id: &str,
    tmp_output: &Path,
    output_path: &Path,
    total_duration: Option<f64>,
) -> Result<()> {
    let tmp_str = tmp_output.to_string_lossy().into_owned();
    let output_str = output_path.to_string_lossy().into_owned();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Paused;

            let percent = if job.progress.is_finite() && job.progress >= 0.0 {
                Some(job.progress)
            } else {
                None
            };

            let media_duration = job
                .media_info
                .as_ref()
                .and_then(|m| m.duration_seconds)
                .or(total_duration);

            let processed_seconds = match (percent, media_duration) {
                (Some(p), Some(total))
                    if p.is_finite() && total.is_finite() && p > 0.0 && total > 0.0 =>
                {
                    Some((p / 100.0) * total)
                }
                _ => None,
            };

            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: percent,
                processed_seconds,
                tmp_output_path: Some(tmp_str.clone()),
            });

            if job.output_path.is_none() {
                job.output_path = Some(output_str.clone());
            }

            // Jobs in a paused/waiting-with-progress state are intentionally
            // kept out of the scheduling queue until an explicit resume
            // command re-enqueues them.
            state.queue.retain(|id| id != job_id);

            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
        }
    }

    notify_queue_listeners(inner);
    mark_smart_scan_child_processed(inner, job_id);
    Ok(())
}

fn mark_job_cancelled(inner: &Inner, job_id: &str) -> Result<()> {
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let restart_after_cancel = state.restart_requests.remove(job_id);

        if let Some(job) = state.jobs.get_mut(job_id) {
            if restart_after_cancel {
                // Reset the job back to Waiting with 0% progress and enqueue
                // it for a fresh run from the beginning.
                job.status = JobStatus::Waiting;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                job.logs
                    .push("Restart requested from UI; job will re-run from 0%".to_string());
                recompute_log_tail(job);

                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
            } else {
                job.status = JobStatus::Cancelled;
                job.progress = 0.0;
                job.end_time = Some(current_time_millis());
                job.logs.push("Cancelled by user".to_string());
                recompute_log_tail(job);
            }
        }

        state.cancelled_jobs.remove(job_id);
    }

    // Notify listeners that the job has transitioned to Cancelled or has been
    // reset for a fresh restart.
    notify_queue_listeners(inner);
    // Wake at least one worker in case a restart enqueued a new job.
    inner.cv.notify_one();
    mark_smart_scan_child_processed(inner, job_id);
    Ok(())
}

// Keep a compact textual tail of recent logs for each job so the UI can show
// diagnostics without unbounded memory growth. The actual log lines live in
// `job.logs`; this helper just materializes a truncated string view.
const MAX_LOG_TAIL_BYTES: usize = 16 * 1024;

fn recompute_log_tail(job: &mut TranscodeJob) {
    if job.logs.is_empty() {
        job.log_tail = None;
        return;
    }

    let joined = job.logs.join("\n");
    if joined.len() > MAX_LOG_TAIL_BYTES {
        let start = joined.len().saturating_sub(MAX_LOG_TAIL_BYTES);
        job.log_tail = Some(joined[start..].to_string());
    } else {
        job.log_tail = Some(joined);
    }
}

fn update_job_progress(
    inner: &Inner,
    job_id: &str,
    percent: Option<f64>,
    log_line: Option<&str>,
    _speed: Option<f64>,
) {
    let mut should_notify = false;

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            if let Some(p) = percent {
                // Clamp progress into [0, 100] and ensure it never regresses so
                // the UI sees a monotonic percentage.
                let clamped = p.clamp(0.0, 100.0);
                if clamped > job.progress {
                    job.progress = clamped;
                    should_notify = true;
                }
            }
            if let Some(line) = log_line {
                // Ignore empty/whitespace-only lines that come from ffmpeg's
                // structured `-progress` output separators. These previously
                // polluted the job logs with大量空白行, making the task detail
                // view hard to read without improving diagnostics, while also
                // generating noisy queue snapshots with no useful content.
                if !line.trim().is_empty() {
                    // Keep only a small rolling window of logs to avoid unbounded growth.
                    if job.logs.len() > 200 {
                        job.logs.drain(0..job.logs.len() - 200);
                    }
                    job.logs.push(line.to_string());
                    recompute_log_tail(job);

                    // Even when ffmpeg does not emit the traditional "time=... speed=..."
                    // progress lines (for example due to loglevel changes or custom
                    // builds), the UI still needs to see streaming log output, the
                    // resolved ffmpeg command, and any media metadata / preview paths.
                    //
                    // To avoid the "no progress / no logs until cancel or completion"
                    // regression, emit a queue snapshot whenever we append a log line
                    // while the job is actively processing. This trades a modest
                    // increase in event frequency for correct, real-time feedback.
                    if job.status == JobStatus::Processing {
                        should_notify = true;
                    }
                }
            }
        }
    }

    // Emit queue snapshots only when progress actually moves forward so the
    // event stream stays efficient while remaining responsive. Log-only
    // updates for processing jobs are also allowed to trigger snapshots so
    // the frontend can show live ffmpeg output even if no percentage can be
    // derived from the current stderr line.
    if should_notify {
        notify_queue_listeners(inner);
    }
}

// Compute a progress percentage for a running job based on the elapsed time
// and, when available, the total duration. For known durations this is a
// direct elapsed/total ratio expressed as a percentage. The caller is
// responsible for keeping a small numerical headroom so that the final step
// to an exact 100% is driven by the terminal state (Completed / Failed /
// Skipped) or an explicit `progress=end` marker from ffmpeg, not by an
// in-flight stderr sample. When the total duration is genuinely unknown we
// return 0.0 instead of inventing a fake curve so that the UI never shows a
// synthetic percentage.
fn compute_progress_percent(total_duration: Option<f64>, elapsed_seconds: f64) -> f64 {
    match total_duration {
        Some(total) if total.is_finite() && total > 0.0 => {
            let elapsed = if elapsed_seconds.is_finite() && elapsed_seconds > 0.0 {
                elapsed_seconds
            } else {
                0.0
            };
            let ratio = elapsed / total;
            let value = (ratio * 100.0).clamp(0.0, 100.0);
            if value.is_finite() {
                value
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}

fn detect_duration_seconds(path: &Path, settings: &AppSettings) -> Result<f64> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| format!("failed to run ffprobe for duration on {}", path.display()))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let first = s.lines().next().unwrap_or_default().trim();
    let duration: f64 = first.parse().unwrap_or(0.0);
    Ok(duration)
}

fn parse_ffmpeg_progress_line(line: &str) -> Option<(f64, Option<f64>)> {
    let mut elapsed: Option<f64> = None;
    let mut speed: Option<f64> = None;

    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix("time=") {
            elapsed = Some(parse_ffmpeg_time_to_seconds(rest));
        } else if let Some(rest) = token.strip_prefix("out_time=") {
            // Structured progress from `-progress pipe:2`, for example
            // `out_time=00:01:23.45`.
            elapsed = Some(parse_ffmpeg_time_to_seconds(rest));
        } else if let Some(rest) = token.strip_prefix("out_time_ms=") {
            // Timestamps from `-progress` named `out_time_ms` are actually
            // expressed in microseconds (see FFmpeg ticket #7345). Convert
            // them to seconds so they remain consistent with `out_time` and
            // ffprobe's `duration` field.
            if let Ok(us) = rest.parse::<f64>() {
                elapsed = Some(us / 1_000_000.0);
            }
        } else if let Some(rest) = token.strip_prefix("speed=") {
            let value = rest.trim_end_matches('x');
            if let Ok(v) = value.parse::<f64>() {
                speed = Some(v);
            }
        }
    }

    elapsed.map(|e| (e, speed))
}

fn is_ffmpeg_progress_end(line: &str) -> bool {
    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix("progress=") {
            if rest.eq_ignore_ascii_case("end") {
                return true;
            }
        }
    }
    false
}

fn parse_ffmpeg_time_to_seconds(s: &str) -> f64 {
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() == 3 {
            let h = parts[0].parse::<f64>().unwrap_or(0.0);
            let m = parts[1].parse::<f64>().unwrap_or(0.0);
            let sec = parts[2].parse::<f64>().unwrap_or(0.0);
            return h * 3600.0 + m * 60.0 + sec;
        }
    }
    s.parse::<f64>().unwrap_or(0.0)
}

fn parse_ffmpeg_duration_from_metadata_line(line: &str) -> Option<f64> {
    // Typical header: "  Duration: 00:01:29.95, start: 0.000000, bitrate: 20814 kb/s"
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let time_str = rest.trim().split(',').next().unwrap_or("").trim();
    if time_str.is_empty() {
        return None;
    }
    let seconds = parse_ffmpeg_time_to_seconds(time_str);
    if seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

fn is_image_file(path: &Path) -> bool {
    let ext = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        Some(ext) => ext,
        None => return false,
    };
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "bmp" | "tif" | "tiff" | "webp" | "avif"
    )
}

fn build_image_avif_paths(path: &Path) -> (PathBuf, PathBuf) {
    // 最终 AVIF 目标始终使用 .avif 扩展名，以便系统和工具能够正确识别格式。
    let avif_target = path.with_extension("avif");
    // 临时文件使用 *.tmp.avif，保证 ffmpeg 等工具可根据最后一个扩展名推断为 AVIF。
    let tmp_output = path.with_extension("tmp.avif");
    (avif_target, tmp_output)
}

fn is_smart_scan_style_output(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name.to_ascii_lowercase(),
        None => return false,
    };

    // 所有 .avif 文件都视为潜在 Smart Scan 输出；在实际逻辑中我们已经避免对
    // 这些文件再次发起压缩任务。
    if file_name.ends_with(".avif") {
        return true;
    }

    // 形如 foo.compressed.mp4 或 foo.compressed (1).mp4 等命名，统一视为
    // Smart Scan 风格输出。
    if file_name.contains(".compressed") {
        return true;
    }

    false
}

fn is_video_file(path: &Path) -> bool {
    let ext = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        Some(ext) => ext,
        None => return false,
    };
    matches!(
        ext.as_str(),
        "mp4" | "mkv" | "mov" | "avi" | "flv" | "ts" | "m2ts" | "wmv"
    )
}

impl TranscodingEngine {
    fn handle_image_file(
        &self,
        path: &Path,
        config: &SmartScanConfig,
        settings: &AppSettings,
        batch_id: &str,
    ) -> Result<TranscodeJob> {
        let metadata = fs::metadata(path)
            .with_context(|| format!("failed to stat image file {}", path.display()))?;
        let original_size_bytes = metadata.len();
        let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();

        let mut job = TranscodeJob {
            id: self.next_job_id(),
            filename,
            job_type: JobType::Image,
            source: JobSource::SmartScan,
            queue_order: None,
            original_size_mb,
            original_codec: path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase()),
            preset_id: config.video_preset_id.clone(),
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: None,
            end_time: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some(path.to_string_lossy().into_owned()),
            output_path: None,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: Some(original_size_mb),
            }),
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: Some(batch_id.to_string()),
            wait_metadata: None,
        };

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();

        if ext == "avif" {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.skip_reason = Some("Already AVIF".to_string());
            return Ok(job);
        }

        if original_size_bytes < config.min_image_size_kb * 1024 {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.skip_reason = Some(format!("Size < {}KB", config.min_image_size_kb));
            return Ok(job);
        }

        // Example.png -> Example.avif in same directory.
        let (avif_target, tmp_output) = build_image_avif_paths(path);
        if avif_target.exists() {
            // Treat existing AVIF as a known Smart Scan output so future
            // batches can reliably skip it as a candidate.
            register_known_smart_scan_output_with_inner(&self.inner, &avif_target);

            // Prefer the existing AVIF sibling as the preview surface so the UI
            // can show the final compressed result instead of the original PNG.
            job.preview_path = Some(avif_target.to_string_lossy().into_owned());
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.skip_reason = Some("Existing .avif sibling".to_string());
            return Ok(job);
        }

        // 首选 avifenc；如果不可用或编码失败，再回退到 ffmpeg 做 AVIF 编码。
        let (tried_avifenc, last_error): (bool, Option<anyhow::Error>) = match ensure_tool_available(
            ExternalToolKind::Avifenc,
            &settings.tools,
        ) {
            Ok((avifenc_path, _source, did_download)) => {
                if did_download {
                    job.logs.push(format!(
                            "auto-download: avifenc was downloaded automatically according to current settings (path: {avifenc_path})"
                        ));
                    // Persist avifenc download metadata so future runs can reuse it.
                    self.record_tool_download(ExternalToolKind::Avifenc, &avifenc_path);
                }

                let start_ms = current_time_millis();
                job.start_time = Some(start_ms);

                let mut cmd = Command::new(&avifenc_path);
                configure_background_command(&mut cmd);
                let output = cmd
                    .arg("--lossless")
                    .arg(path.as_os_str())
                    .arg(&tmp_output)
                    .output()
                    .with_context(|| format!("failed to run avifenc on {}", path.display()));

                let last_error = match output {
                    Ok(output) if output.status.success() => {
                        let tmp_meta = fs::metadata(&tmp_output).with_context(|| {
                            format!("failed to stat temp output {}", tmp_output.display())
                        })?;
                        let new_size_bytes = tmp_meta.len();
                        let ratio = new_size_bytes as f64 / original_size_bytes as f64;

                        if ratio > config.min_saving_ratio {
                            let _ = fs::remove_file(&tmp_output);
                            job.status = JobStatus::Skipped;
                            job.progress = 100.0;
                            job.end_time = Some(current_time_millis());
                            job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
                            return Ok(job);
                        }

                        fs::rename(&tmp_output, &avif_target).with_context(|| {
                            format!(
                                "failed to rename {} -> {}",
                                tmp_output.display(),
                                avif_target.display()
                            )
                        })?;

                        register_known_smart_scan_output_with_inner(&self.inner, &avif_target);

                        job.status = JobStatus::Completed;
                        job.progress = 100.0;
                        job.end_time = Some(current_time_millis());
                        job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
                        job.preview_path = Some(avif_target.to_string_lossy().into_owned());
                        job.preview_path = Some(avif_target.to_string_lossy().into_owned());

                        return Ok(job);
                    }
                    Ok(output) => {
                        // avifenc 本身返回非 0，记录错误并尝试回退到 ffmpeg。
                        job.logs
                            .push(String::from_utf8_lossy(&output.stderr).to_string());
                        let _ = fs::remove_file(&tmp_output);
                        Some(anyhow::anyhow!(
                            "avifenc exited with non-zero status: {}",
                            output.status
                        ))
                    }
                    Err(err) => {
                        let _ = fs::remove_file(&tmp_output);
                        Some(err)
                    }
                };

                (true, last_error)
            }
            Err(err) => (false, Some(err)),
        };

        // 如果 avifenc 不可用或失败，尝试用 ffmpeg 做 AVIF 编码兜底。
        job.logs.push(match (&last_error, tried_avifenc) {
            (Some(err), true) => {
                format!("avifenc encode failed, falling back to ffmpeg-based AVIF encode: {err:#}")
            }
            (Some(err), false) => format!(
                "avifenc is not available ({err:#}); falling back to ffmpeg-based AVIF encode"
            ),
            (None, _) => "avifenc not used; falling back to ffmpeg-based AVIF encode".to_string(),
        });

        let (ffmpeg_path, _source, did_download_ffmpeg) =
            ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

        if did_download_ffmpeg {
            job.logs.push(format!(
                "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
            ));
            self.record_tool_download(ExternalToolKind::Ffmpeg, &ffmpeg_path);
        }

        if job.start_time.is_none() {
            job.start_time = Some(current_time_millis());
        }

        let mut cmd = Command::new(&ffmpeg_path);
        configure_background_command(&mut cmd);
        let output = cmd
            .arg("-y")
            .arg("-i")
            .arg(path.as_os_str())
            .arg("-frames:v")
            .arg("1")
            .arg("-c:v")
            .arg("libaom-av1")
            .arg("-still-picture")
            .arg("1")
            .arg("-pix_fmt")
            .arg("yuv444p10le")
            .arg(&tmp_output)
            .output()
            .with_context(|| format!("failed to run ffmpeg for AVIF on {}", path.display()))?;

        if !output.status.success() {
            job.status = JobStatus::Failed;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            job.logs
                .push(String::from_utf8_lossy(&output.stderr).to_string());
            let _ = fs::remove_file(&tmp_output);
            return Ok(job);
        }

        let tmp_meta = fs::metadata(&tmp_output)
            .with_context(|| format!("failed to stat temp output {}", tmp_output.display()))?;
        let new_size_bytes = tmp_meta.len();
        let ratio = new_size_bytes as f64 / original_size_bytes as f64;

        if ratio > config.min_saving_ratio {
            let _ = fs::remove_file(&tmp_output);
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
            return Ok(job);
        }

        fs::rename(&tmp_output, &avif_target).with_context(|| {
            format!(
                "failed to rename {} -> {}",
                tmp_output.display(),
                avif_target.display()
            )
        })?;

        register_known_smart_scan_output_with_inner(&self.inner, &avif_target);

        job.status = JobStatus::Completed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));

        Ok(job)
    }

    #[allow(dead_code)]
    fn handle_video_file(
        &self,
        path: &Path,
        config: &SmartScanConfig,
        settings: &AppSettings,
        preset: Option<FFmpegPreset>,
        batch_id: &str,
    ) -> Result<TranscodeJob> {
        let metadata = fs::metadata(path)
            .with_context(|| format!("failed to stat video file {}", path.display()))?;
        let original_size_bytes = metadata.len();
        let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let input_path = path.to_string_lossy().into_owned();

        let mut job = TranscodeJob {
            id: self.next_job_id(),
            filename,
            job_type: JobType::Video,
            source: JobSource::SmartScan,
            queue_order: None,
            original_size_mb,
            original_codec: None,
            preset_id: config.video_preset_id.clone(),
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: None,
            end_time: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some(input_path.clone()),
            output_path: Some(build_video_output_path(path).to_string_lossy().into_owned()),
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: Some(original_size_mb),
            }),
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: Some(batch_id.to_string()),
            wait_metadata: None,
        };

        if original_size_mb < config.min_video_size_mb as f64 {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.skip_reason = Some(format!("Size < {}MB", config.min_video_size_mb));
            return Ok(job);
        }

        let codec = detect_video_codec(path, settings).ok();
        if let Some(ref name) = codec {
            job.original_codec = Some(name.clone());
            if let Some(info) = job.media_info.as_mut() {
                info.video_codec = Some(name.clone());
            }
            let lower = name.to_ascii_lowercase();
            if matches!(lower.as_str(), "hevc" | "hevc_nvenc" | "h265" | "av1") {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.skip_reason = Some(format!("Codec is already {name}"));
                return Ok(job);
            }
        }

        let preset = match preset {
            Some(p) => p,
            None => {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.skip_reason = Some("No matching preset for videoPresetId".to_string());
                return Ok(job);
            }
        };

        // Pre-compute an approximate processing time for this job so the
        // taskbar can weight mixed workloads (e.g. small but very slow
        // presets) more accurately than a pure size-based heuristic.
        job.estimated_seconds = estimate_job_seconds_for_preset(original_size_mb, &preset);

        let (ffmpeg_path, _source, did_download) =
            ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

        let output_path = build_video_output_path(path);
        let tmp_output = build_video_tmp_output_path(path);

        let args = build_ffmpeg_args(&preset, path, &tmp_output);

        if did_download {
            job.logs.push(format!(
                "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
            ));
            self.record_tool_download(ExternalToolKind::Ffmpeg, &ffmpeg_path);
        }

        let start_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        job.start_time = Some(start_ms);

        let mut cmd = Command::new(&ffmpeg_path);
        configure_background_command(&mut cmd);
        let output = cmd
            .args(&args)
            .output()
            .with_context(|| format!("failed to run ffmpeg on {}", path.display()))?;

        if !output.status.success() {
            job.status = JobStatus::Failed;
            job.progress = 100.0;
            job.end_time = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
            job.logs
                .push(String::from_utf8_lossy(&output.stderr).to_string());
            let _ = fs::remove_file(&tmp_output);
            return Ok(job);
        }

        let tmp_meta = fs::metadata(&tmp_output)
            .with_context(|| format!("failed to stat temp output {}", tmp_output.display()))?;
        let new_size_bytes = tmp_meta.len();
        let ratio = new_size_bytes as f64 / original_size_bytes as f64;

        if ratio > config.min_saving_ratio {
            let _ = fs::remove_file(&tmp_output);
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.end_time = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
            job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
            return Ok(job);
        }

        fs::rename(&tmp_output, &output_path).with_context(|| {
            format!(
                "failed to rename {} -> {}",
                tmp_output.display(),
                output_path.display()
            )
        })?;

        job.status = JobStatus::Completed;
        job.progress = 100.0;
        job.end_time = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
        job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));

        Ok(job)
    }
}

fn detect_video_codec(path: &Path, settings: &AppSettings) -> Result<String> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=codec_name")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| {
            let display = path.display();
            format!("failed to run ffprobe on {display}")
        })?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    Ok(s.lines().next().unwrap_or_default().trim().to_string())
}

fn parse_ffprobe_frame_rate(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((num, den)) = trimmed.split_once('/') {
        let num: f64 = num.parse().ok()?;
        let den: f64 = den.parse().ok()?;
        if den <= 0.0 {
            return None;
        }
        return Some(num / den);
    }

    trimmed.parse().ok()
}

fn detect_video_dimensions_and_frame_rate(
    path: &Path,
    settings: &AppSettings,
) -> Result<(Option<u32>, Option<u32>, Option<f64>)> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=width,height,avg_frame_rate")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(path.as_os_str())
        .output()
        .with_context(|| format!("failed to run ffprobe for dimensions on {}", path.display()))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let mut lines = s.lines();
    let width = lines.next().and_then(|l| l.trim().parse::<u32>().ok());
    let height = lines.next().and_then(|l| l.trim().parse::<u32>().ok());
    let frame_rate = lines
        .next()
        .and_then(|l| parse_ffprobe_frame_rate(l.trim()));

    Ok((width, height, frame_rate))
}

fn build_video_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.{ext}"))
}

fn reserve_unique_smart_scan_video_output_path(state: &mut EngineState, input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");

    let mut index: u32 = 0;
    loop {
        let candidate = if index == 0 {
            parent.join(format!("{stem}.compressed.{ext}"))
        } else {
            parent.join(format!("{stem}.compressed ({index}).{ext}"))
        };

        let candidate_str = candidate.to_string_lossy().into_owned();
        if !candidate.exists() && !state.known_smart_scan_outputs.contains(&candidate_str) {
            state.known_smart_scan_outputs.insert(candidate_str.clone());
            break candidate;
        }

        index += 1;
    }
}

// Temporary output path for video transcodes. We keep the final container
// extension (e.g. .mp4) so that ffmpeg can still auto-detect the muxer based
// on the filename, and only insert ".tmp" before the extension. After a
// successful run we rename this file to the stable output path to make the
// operation atomic from the user's perspective.
fn build_video_tmp_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.tmp.{ext}"))
}

fn preview_root_dir() -> PathBuf {
    let exe = std::env::current_exe().ok();
    let dir = exe
        .as_ref()
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.join("previews")
}

fn build_preview_output_path(input: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    input.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    preview_root_dir().join(format!("{hash:016x}.jpg"))
}

fn compute_preview_seek_seconds(total_duration: Option<f64>, capture_percent: u8) -> f64 {
    const DEFAULT_SEEK_SECONDS: f64 = 3.0;

    let duration = match total_duration {
        Some(d) if d.is_finite() && d > 0.0 => d,
        _ => return DEFAULT_SEEK_SECONDS,
    };

    // Clamp the configured percentage into a sane range so bogus configs
    // cannot cause us to seek past the end or before the first second.
    let percent = (capture_percent as f64).clamp(0.0, 100.0);
    let raw = duration * percent / 100.0;

    // For very short clips, prefer a simple midpoint to avoid degenerate
    // ranges where `duration - 1` becomes <= 1.
    if duration <= 2.0 {
        return (duration / 2.0).max(0.0);
    }

    let min = 1.0;
    let max = (duration - 1.0).max(min);
    raw.clamp(min, max)
}

fn generate_preview_for_video(
    input: &Path,
    ffmpeg_path: &str,
    total_duration: Option<f64>,
    capture_percent: u8,
) -> Option<PathBuf> {
    let preview_path = build_preview_output_path(input);

    if preview_path.exists() {
        return Some(preview_path);
    }

    if let Some(parent) = preview_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let seek_seconds = compute_preview_seek_seconds(total_duration, capture_percent);
    let ss_arg = format!("{seek_seconds:.3}");

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-ss")
        .arg(&ss_arg)
        .arg("-i")
        .arg(input.as_os_str())
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(preview_path.as_os_str())
        .status()
        .ok()?;

    if status.success() {
        Some(preview_path)
    } else {
        let _ = fs::remove_file(&preview_path);
        None
    }
}

// Build a human-readable command line for logging, quoting arguments that
// contain spaces to make it easier to copy/paste for debugging.
fn format_command_for_log(program: &str, args: &[String]) -> String {
    fn quote_arg(arg: &str) -> String {
        if arg.contains(' ') {
            format!("\"{arg}\"")
        } else {
            arg.to_string()
        }
    }

    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_arg(program));
    for arg in args {
        parts.push(quote_arg(arg));
    }
    parts.join(" ")
}

// Append the full external command line to the job logs so that the queue UI
// can always show users exactly what was executed, even if the tool exits
// before emitting any progress or error output.
fn log_external_command(inner: &Inner, job_id: &str, program: &str, args: &[String]) {
    let mut state = inner.state.lock().expect("engine state poisoned");
    if let Some(job) = state.jobs.get_mut(job_id) {
        let cmd = format_command_for_log(program, args);
        job.ffmpeg_command = Some(cmd.clone());
        job.logs.push(format!("command: {cmd}"));

        // If the advanced ffmpeg template or args force a very restrictive log
        // level (for example `-v error` or `-loglevel quiet`), ffmpeg will not
        // emit the usual `time=...` progress lines. In that configuration the
        // backend cannot compute real percentages and the UI will only ever
        // see 0% and the final 100%. Detect this early and surface a clear
        // hint in the job logs so users understand why the bar appears stuck.
        let mut suppressed = false;
        let mut iter = args.iter().peekable();
        while let Some(arg) = iter.next() {
            if arg == "-v" {
                if let Some(level) = iter.peek() {
                    let level = level.to_ascii_lowercase();
                    if level == "error" || level == "fatal" || level == "panic" || level == "quiet"
                    {
                        suppressed = true;
                        break;
                    }
                }
            } else if let Some(rest) = arg.strip_prefix("-loglevel") {
                let level = rest.trim_start_matches('=').to_ascii_lowercase();
                if level == "error" || level == "fatal" || level == "panic" || level == "quiet" {
                    suppressed = true;
                    break;
                }
            }
        }

        if suppressed {
            job.logs.push(
                "warning: ffmpeg log level is set to 'error/quiet'; live progress cannot be \
computed from stderr, so the queue may only show 0% and 100%"
                    .to_string(),
            );
            recompute_log_tail(job);
        }
    }
}

/// Roughly estimate how long a job with the given input size would take when
/// encoded with the provided preset. This is intentionally conservative and
/// only needs to be accurate enough for relative weighting of jobs when
/// aggregating queue progress for the Windows taskbar.
fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let stats = &preset.stats;
    if stats.total_input_size_mb <= 0.0 || stats.total_time_seconds <= 0.0 {
        return None;
    }

    // Baseline: average seconds-per-megabyte observed for this preset.
    let mut seconds_per_mb = stats.total_time_seconds / stats.total_input_size_mb;
    if !seconds_per_mb.is_finite() || seconds_per_mb <= 0.0 {
        return None;
    }

    // Adjust for encoder and preset "speed" where we have simple signals so
    // that obviously heavy configurations (e.g. libsvtav1, veryslow) are
    // weighted higher than fast ones.
    use crate::transcoding::domain::EncoderType;

    let mut factor = 1.0f64;

    match preset.video.encoder {
        EncoderType::LibSvtAv1 => {
            // Modern AV1 encoders tend to be considerably slower.
            factor *= 1.5;
        }
        EncoderType::HevcNvenc => {
            // Hardware HEVC is usually fast; keep this close to 1.0 so size
            // remains the dominant factor.
            factor *= 0.9;
        }
        _ => {}
    }

    let preset_name = preset.video.preset.to_ascii_lowercase();
    if preset_name.contains("veryslow") {
        factor *= 1.6;
    } else if preset_name.contains("slow") {
        factor *= 1.3;
    } else if preset_name.contains("fast") {
        factor *= 0.8;
    }

    if let Some(pass) = preset.video.pass {
        if pass >= 2 {
            // Two-pass encoding roughly doubles total processing time.
            factor *= 2.0;
        }
    }

    seconds_per_mb *= factor;
    let estimate = size_mb * seconds_per_mb;
    if !estimate.is_finite() || estimate <= 0.0 {
        None
    } else {
        Some(estimate)
    }
}

fn ensure_progress_args(args: &mut Vec<String>) {
    // Ensure ffmpeg emits machine-readable progress lines so the backend can
    // compute real-time percentages even when the human stats line only uses
    // carriage returns.
    if args.iter().any(|arg| arg == "-progress") {
        return;
    }

    // Use `pipe:2` so structured progress goes to stderr alongside regular logs.
    args.insert(0, "pipe:2".to_string());
    args.insert(0, "-progress".to_string());
}

fn build_ffmpeg_args(preset: &FFmpegPreset, input: &Path, output: &Path) -> Vec<String> {
    if preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    {
        if let Some(template) = &preset.ffmpeg_template {
            let with_input = template.replace("INPUT", input.to_string_lossy().as_ref());
            let with_output = with_input.replace("OUTPUT", output.to_string_lossy().as_ref());
            let mut args: Vec<String> = with_output
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            ensure_progress_args(&mut args);
            return args;
        }
    }

    let mut args: Vec<String> = Vec::new();
    ensure_progress_args(&mut args);

    // Input
    args.push("-i".to_string());
    args.push(input.to_string_lossy().into_owned());

    // Video
    match preset.video.encoder {
        super::domain::EncoderType::Copy => {
            args.push("-c:v".to_string());
            args.push("copy".to_string());
        }
        ref enc => {
            args.push("-c:v".to_string());
            let enc_name = match enc {
                super::domain::EncoderType::Libx264 => "libx264",
                super::domain::EncoderType::HevcNvenc => "hevc_nvenc",
                super::domain::EncoderType::LibSvtAv1 => "libsvtav1",
                super::domain::EncoderType::Copy => "copy",
            };
            args.push(enc_name.to_string());

            match preset.video.rate_control {
                super::domain::RateControlMode::Crf => {
                    args.push("-crf".to_string());
                    args.push(preset.video.quality_value.to_string());
                }
                super::domain::RateControlMode::Cq => {
                    args.push("-cq".to_string());
                    args.push(preset.video.quality_value.to_string());
                }
                super::domain::RateControlMode::Cbr | super::domain::RateControlMode::Vbr => {
                    if let Some(bitrate) = preset.video.bitrate_kbps {
                        if bitrate > 0 {
                            args.push("-b:v".to_string());
                            args.push(format!("{bitrate}k"));
                        }
                    }
                    if let Some(maxrate) = preset.video.max_bitrate_kbps {
                        if maxrate > 0 {
                            args.push("-maxrate".to_string());
                            args.push(format!("{maxrate}k"));
                        }
                    }
                    if let Some(bufsize) = preset.video.buffer_size_kbits {
                        if bufsize > 0 {
                            args.push("-bufsize".to_string());
                            args.push(format!("{bufsize}k"));
                        }
                    }
                    if let Some(pass) = preset.video.pass {
                        if pass == 1 || pass == 2 {
                            args.push("-pass".to_string());
                            args.push(pass.to_string());
                        }
                    }
                }
            }

            if !preset.video.preset.is_empty() {
                args.push("-preset".to_string());
                args.push(preset.video.preset.clone());
            }
            if let Some(tune) = &preset.video.tune {
                if !tune.is_empty() {
                    args.push("-tune".to_string());
                    args.push(tune.clone());
                }
            }
            if let Some(profile) = &preset.video.profile {
                if !profile.is_empty() {
                    args.push("-profile:v".to_string());
                    args.push(profile.clone());
                }
            }
        }
    }

    // Audio
    match preset.audio.codec {
        super::domain::AudioCodecType::Copy => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        super::domain::AudioCodecType::Aac => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            if let Some(bitrate) = preset.audio.bitrate {
                args.push("-b:a".to_string());
                args.push(format!("{bitrate}k"));
            }
        }
    }

    // Filters
    let mut vf_parts: Vec<String> = Vec::new();
    if let Some(scale) = &preset.filters.scale {
        if !scale.is_empty() {
            vf_parts.push(format!("scale={scale}"));
        }
    }
    if let Some(crop) = &preset.filters.crop {
        if !crop.is_empty() {
            vf_parts.push(format!("crop={crop}"));
        }
    }
    if let Some(fps) = preset.filters.fps {
        if fps > 0 {
            vf_parts.push(format!("fps={fps}"));
        }
    }
    if !vf_parts.is_empty() {
        args.push("-vf".to_string());
        args.push(vf_parts.join(","));
    }

    // Output
    args.push(output.to_string_lossy().into_owned());

    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcoding::domain::{
        AudioCodecType, AudioConfig, EncoderType, FilterConfig, PresetStats, RateControlMode,
        VideoConfig,
    };
    use crate::transcoding::ImageTargetFormat;
    use std::env;
    use std::fs::{self, File};
    use std::io::Write;
    use std::sync::{Arc as TestArc, Mutex as TestMutex};

    fn make_test_preset() -> FFmpegPreset {
        FFmpegPreset {
            id: "preset-1".to_string(),
            name: "Test Preset".to_string(),
            description: "Preset used for unit tests".to_string(),
            video: VideoConfig {
                encoder: EncoderType::Libx264,
                rate_control: RateControlMode::Crf,
                quality_value: 23,
                preset: "medium".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
            },
            audio: AudioConfig {
                codec: AudioCodecType::Copy,
                bitrate: None,
            },
            filters: FilterConfig {
                scale: None,
                crop: None,
                fps: None,
            },
            stats: PresetStats {
                usage_count: 0,
                total_input_size_mb: 0.0,
                total_output_size_mb: 0.0,
                total_time_seconds: 0.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        }
    }

    fn make_engine_with_preset() -> TranscodingEngine {
        let presets = vec![make_test_preset()];
        let settings = AppSettings::default();
        let inner = Arc::new(Inner::new(presets, settings));
        TranscodingEngine { inner }
    }

    #[test]
    fn multi_worker_selection_respects_fifo_and_processing_limit() {
        let engine = make_engine_with_preset();

        // Enqueue several synthetic jobs to populate the in-memory queue.
        let mut job_ids_in_order = Vec::new();
        for i in 0..6 {
            let job = engine.enqueue_transcode_job(
                format!("C:/videos/input-{i}.mp4"),
                JobType::Video,
                JobSource::Manual,
                100.0,
                Some("h264".into()),
                "preset-1".into(),
            );
            job_ids_in_order.push(job.id.clone());
        }

        let workers = 3usize;
        let mut selected = Vec::new();

        {
            let mut state = engine.inner.state.lock().expect("engine state poisoned");

            for _ in 0..workers {
                if let Some(id) = next_job_for_worker_locked(&mut state) {
                    selected.push(id);
                }
            }

            // No matter how many jobs are waiting, at most `workers` jobs may
            // be marked Processing at the same time.
            let processing_count = state
                .jobs
                .values()
                .filter(|j| j.status == JobStatus::Processing)
                .count();
            assert!(
                processing_count <= workers,
                "processing job count {processing_count} must not exceed worker slots {workers}"
            );
        }

        // The jobs taken by the simulated workers must correspond to the
        // earliest enqueued jobs in FIFO order.
        let expected: Vec<String> = job_ids_in_order
            .iter()
            .take(selected.len())
            .cloned()
            .collect();
        assert_eq!(
            selected, expected,
            "workers must always take jobs from the front of the queue in FIFO order"
        );
    }

    #[test]
    fn cancelling_processing_job_in_multi_worker_pool_only_affects_target_job() {
        let engine = make_engine_with_preset();

        // Enqueue a few jobs and mark two of them as processing, as if two
        // worker threads had claimed work from the queue.
        let mut job_ids_in_order = Vec::new();
        for i in 0..4 {
            let job = engine.enqueue_transcode_job(
                format!("C:/videos/cancel-{i}.mp4"),
                JobType::Video,
                JobSource::Manual,
                100.0,
                Some("h264".into()),
                "preset-1".into(),
            );
            job_ids_in_order.push(job.id.clone());
        }

        let workers = 2usize;
        let mut processing_ids = Vec::new();
        {
            let mut state = engine.inner.state.lock().expect("engine state poisoned");
            for _ in 0..workers {
                if let Some(id) = next_job_for_worker_locked(&mut state) {
                    processing_ids.push(id);
                }
            }
        }

        assert_eq!(
            processing_ids.len(),
            workers,
            "expected to simulate {workers} processing jobs"
        );

        let target = processing_ids[0].clone();
        let other = processing_ids[1].clone();

        // Request cancellation of one processing job.
        let cancelled = engine.cancel_job(&target);
        assert!(
            cancelled,
            "cancel_job must succeed for a job in Processing status"
        );

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            assert!(
                state.cancelled_jobs.contains(&target),
                "cancelled_jobs set must contain the target job id"
            );
            assert!(
                !state.cancelled_jobs.contains(&other),
                "cancelled_jobs set must not contain other processing jobs"
            );
        }

        // Simulate the cooperative cancellation path that process_transcode_job
        // would take once it observes the cancelled flag.
        mark_job_cancelled(&engine.inner, &target)
            .expect("mark_job_cancelled must succeed for target job");

        let state = engine.inner.state.lock().expect("engine state poisoned");

        let target_job = state
            .jobs
            .get(&target)
            .expect("cancelled job must remain in jobs map");
        assert_eq!(
            target_job.status,
            JobStatus::Cancelled,
            "target job must transition to Cancelled status after cooperative cancellation"
        );

        let other_job = state
            .jobs
            .get(&other)
            .expect("other processing job must remain in jobs map");
        assert_eq!(
            other_job.status,
            JobStatus::Processing,
            "other processing jobs must remain Processing when only one job is cancelled"
        );
    }

    #[test]
    fn wait_and_resume_preserve_progress_and_queue_membership() {
        let engine = make_engine_with_preset();

        let job = engine.enqueue_transcode_job(
            "C:/videos/wait-resume.mp4".to_string(),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );

        // Simulate the worker having taken this job from the queue and made
        // some progress.
        {
            let mut state = engine.inner.state.lock().expect("engine state poisoned");
            // Pop the job from the queue as next_job_for_worker_locked would.
            assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
            if let Some(j) = state.jobs.get_mut(&job.id) {
                j.status = JobStatus::Processing;
                j.progress = 40.0;
                j.media_info = Some(MediaInfo {
                    duration_seconds: Some(100.0),
                    width: None,
                    height: None,
                    frame_rate: None,
                    video_codec: None,
                    audio_codec: None,
                    size_mb: None,
                });
            }
        }

        // Request a wait operation from the frontend.
        let accepted = engine.wait_job(&job.id);
        assert!(accepted, "wait_job must accept a Processing job");

        // Cooperatively apply the wait in the worker loop.
        let tmp = PathBuf::from("C:/videos/wait-resume.compressed.tmp.mp4");
        let out = PathBuf::from("C:/videos/wait-resume.compressed.mp4");
        mark_job_waiting(&engine.inner, &job.id, &tmp, &out, Some(100.0))
            .expect("mark_job_waiting must succeed");

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            let stored = state
                .jobs
                .get(&job.id)
                .expect("job must remain present after wait");
            assert_eq!(
                stored.status,
                JobStatus::Paused,
                "wait should transition job into Paused state"
            );
            assert!(
                (stored.progress - 40.0).abs() < f64::EPSILON,
                "wait should not reset overall progress"
            );
            assert!(
                !state.queue.contains(&job.id),
                "paused job should not be in the active scheduling queue until resumed"
            );
            let meta = stored.wait_metadata.as_ref().expect("wait_metadata present");
            assert_eq!(
                meta.last_progress_percent,
                Some(40.0),
                "wait_metadata.last_progress_percent should capture last progress"
            );
            assert!(
                meta.processed_seconds.unwrap_or(0.0) > 0.0,
                "wait_metadata.processed_seconds should be derived from progress and duration"
            );
            assert_eq!(
                meta.tmp_output_path.as_deref(),
                Some(tmp.to_string_lossy().as_ref()),
                "wait_metadata.tmp_output_path should point to the temp output path"
            );
        }

        // Resume the job and ensure it re-enters the waiting queue without
        // losing progress or wait metadata.
        let resumed = engine.resume_job(&job.id);
        assert!(resumed, "resume_job must accept a Paused job");

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            let stored = state
                .jobs
                .get(&job.id)
                .expect("job must remain present after resume");
            assert_eq!(
                stored.status,
                JobStatus::Waiting,
                "resume should transition job back to Waiting state"
            );
            assert!(
                (stored.progress - 40.0).abs() < f64::EPSILON,
                "resume should keep existing overall progress"
            );
            assert!(
                state.queue.contains(&job.id),
                "resumed job must re-enter the waiting queue"
            );
            assert!(
                stored.wait_metadata.is_some(),
                "wait_metadata should remain available after resume"
            );
        }

        // Finally, restart the job and verify progress is reset to 0% and
        // wait metadata cleared while the job remains enqueued.
        let restarted = engine.restart_job(&job.id);
        assert!(
            restarted,
            "restart_job must accept a non-terminal, non-processing job"
        );

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            let stored = state
                .jobs
                .get(&job.id)
                .expect("job must remain present after restart");
            assert_eq!(
                stored.status,
                JobStatus::Waiting,
                "restart must reset job back to Waiting state"
            );
            assert!(
                (stored.progress - 0.0).abs() < f64::EPSILON,
                "restart must reset progress back to 0%"
            );
            assert!(
                stored.wait_metadata.is_none(),
                "restart must clear wait_metadata so the new run starts fresh"
            );
            assert!(
                state.queue.contains(&job.id),
                "restarted job must be present in the waiting queue"
            );
        }
    }

    #[test]
    fn restart_processing_job_schedules_cooperative_cancel_and_fresh_run() {
        let engine = make_engine_with_preset();

        let job = engine.enqueue_transcode_job(
            "C:/videos/restart-processing.mp4".to_string(),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );

        // Simulate the worker having taken this job from the queue.
        {
            let mut state = engine.inner.state.lock().expect("engine state poisoned");
            assert_eq!(state.queue.pop_front(), Some(job.id.clone()));
            if let Some(j) = state.jobs.get_mut(&job.id) {
                j.status = JobStatus::Processing;
                j.progress = 25.0;
            }
        }

        let restarted = engine.restart_job(&job.id);
        assert!(restarted, "restart_job must accept a Processing job");

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            assert!(
                state.cancelled_jobs.contains(&job.id),
                "restart_job must mark the job as cancelled for cooperative cancellation"
            );
            assert!(
                state.restart_requests.contains(&job.id),
                "restart_job must remember that the job should be restarted after cancellation"
            );
        }

        // Simulate the cooperative cancellation path.
        mark_job_cancelled(&engine.inner, &job.id)
            .expect("mark_job_cancelled must succeed for restart scenario");

        {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            let stored = state
                .jobs
                .get(&job.id)
                .expect("job must remain present after cooperative restart");
            assert_eq!(
                stored.status,
                JobStatus::Waiting,
                "after cooperative restart the job must be back in Waiting state"
            );
            assert!(
                (stored.progress - 0.0).abs() < f64::EPSILON,
                "after cooperative restart progress must be reset to 0%"
            );
            assert!(
                state.queue.contains(&job.id),
                "after cooperative restart the job must be re-enqueued for a fresh run"
            );
            assert!(
                !state.cancelled_jobs.contains(&job.id),
                "cancelled_jobs set must be cleared after restart"
            );
            assert!(
                !state.restart_requests.contains(&job.id),
                "restart_requests set must be cleared after restart"
            );
        }
    }

    #[test]
    fn build_ffmpeg_args_injects_progress_flags_for_standard_preset() {
        let preset = make_test_preset();
        let input = PathBuf::from("C:/Videos/input file.mp4");
        let output = PathBuf::from("C:/Videos/output.tmp.mp4");

        let args = build_ffmpeg_args(&preset, &input, &output);
        let joined = args.join(" ");

        assert!(
            joined.contains("-progress") && joined.contains("pipe:2"),
            "ffmpeg args must include -progress pipe:2 for structured progress, got: {joined}"
        );
    }

    #[test]
    fn build_ffmpeg_args_respects_existing_progress_flag_in_template() {
        let mut preset = make_test_preset();
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template =
            Some("-progress pipe:2 -i INPUT -c:v libx264 -crf 23 OUTPUT".to_string());

        let input = PathBuf::from("C:/Videos/input.mp4");
        let output = PathBuf::from("C:/Videos/output.tmp.mp4");
        let args = build_ffmpeg_args(&preset, &input, &output);

        let progress_flags = args.iter().filter(|a| a.as_str() == "-progress").count();
        assert_eq!(
            progress_flags, 1,
            "build_ffmpeg_args must not inject a duplicate -progress flag when template already specifies one"
        );
    }

    #[test]
    fn enqueue_transcode_job_uses_actual_file_size_and_waiting_status() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_video.mp4");

        // Create a ~5 MB file to have a deterministic, non-zero size.
        {
            let mut file = File::create(&path).expect("create temp video file");
            let data = vec![0u8; 5 * 1024 * 1024];
            file.write_all(&data)
                .expect("write data to temp video file");
        }

        let engine = make_engine_with_preset();
        let job = engine.enqueue_transcode_job(
            path.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,                 // caller-provided size should be ignored
            Some("h264".into()), // optional codec
            "preset-1".into(),
        );

        // original_size_mb should be derived from the real file size and be > 0.
        assert!(job.original_size_mb > 4.5 && job.original_size_mb < 5.5);
        assert_eq!(job.status, JobStatus::Waiting);

        // Queue state should contain the same value.
        let state = engine.queue_state();
        let stored = state
            .jobs
            .into_iter()
            .find(|j| j.id == job.id)
            .expect("job present in queue_state");
        assert!((stored.original_size_mb - job.original_size_mb).abs() < 0.0001);
        assert_eq!(stored.status, JobStatus::Waiting);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn cancel_job_cancels_waiting_job_and_removes_from_queue() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_cancel.mp4");

        {
            let mut file = File::create(&path).expect("create temp video file for cancel test");
            let data = vec![0u8; 1024 * 1024];
            file.write_all(&data)
                .expect("write data to temp video file for cancel test");
        }

        let engine = make_engine_with_preset();
        let job = engine.enqueue_transcode_job(
            path.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "preset-1".into(),
        );

        // Cancel while the job is still in Waiting state in the queue.
        let cancelled = engine.cancel_job(&job.id);
        assert!(cancelled, "cancel_job should return true for waiting job");

        // Queue state should now have the job marked as Cancelled with zero progress.
        let state = engine.queue_state();
        let cancelled_job = state
            .jobs
            .into_iter()
            .find(|j| j.id == job.id)
            .expect("cancelled job present in queue_state");
        assert_eq!(cancelled_job.status, JobStatus::Cancelled);
        assert_eq!(cancelled_job.progress, 0.0);

        // Internal engine state should no longer have the job id in the queue,
        // and logs should contain the explanatory message.
        let inner = &engine.inner;
        let state_lock = inner.state.lock().expect("engine state poisoned");
        assert!(
            !state_lock.queue.contains(&job.id),
            "queue should not contain cancelled job id"
        );
        let stored = state_lock
            .jobs
            .get(&job.id)
            .expect("cancelled job should still be stored");
        assert!(
            stored
                .logs
                .iter()
                .any(|log| log.contains("Cancelled before start")),
            "cancelled job should record explanatory log entry"
        );
        drop(state_lock);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn log_external_command_stores_full_command_in_job_logs() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_log_command.mp4");

        {
            let mut file = File::create(&path).expect("create temp video file for log test");
            file.write_all(&[0u8; 1024])
                .expect("write data for log test");
        }

        let engine = make_engine_with_preset();
        let job = engine.enqueue_transcode_job(
            path.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "preset-1".into(),
        );

        let args = vec![
            "-i".to_string(),
            "C:/Videos/input file.mp4".to_string(),
            "C:/Videos/output.tmp.mp4".to_string(),
        ];

        log_external_command(&engine.inner, &job.id, "ffmpeg", &args);

        let state_lock = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state_lock
            .jobs
            .get(&job.id)
            .expect("job should be present after logging command");
        let last_log = stored.logs.last().expect("at least one log entry");

        assert!(
            last_log.contains("ffmpeg"),
            "log should mention the program name"
        );
        assert!(
            last_log.contains("\"C:/Videos/input file.mp4\""),
            "log should quote arguments with spaces"
        );
        assert!(
            last_log.contains("C:/Videos/output.tmp.mp4"),
            "log should include the output path"
        );

        drop(state_lock);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn build_preview_output_path_is_stable_for_same_input() {
        let dir = env::temp_dir();
        let path = dir.join("preview_target.mp4");

        let first = build_preview_output_path(&path);
        let second = build_preview_output_path(&path);

        assert_eq!(
            first, second,
            "preview path must be stable for the same input file"
        );

        let filename = first
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        assert!(
            filename.ends_with(".jpg"),
            "preview path should use a .jpg extension, got {filename}"
        );
    }

    #[test]
    fn image_avif_paths_use_tmp_avif_extension() {
        let path = PathBuf::from("C:/images/sample.png");
        let (avif_target, tmp_output) = build_image_avif_paths(&path);

        let target_str = avif_target.to_string_lossy();
        let tmp_str = tmp_output.to_string_lossy();

        assert!(
            target_str.ends_with(".avif"),
            "final AVIF target must end with .avif, got {target_str}"
        );
        assert!(
            tmp_str.ends_with(".tmp.avif"),
            "temporary AVIF output must end with .tmp.avif so tools can infer AVIF container from extension, got {tmp_str}"
        );
    }

    #[test]
    fn handle_image_file_uses_existing_avif_sibling_as_preview_path() {
        let dir = env::temp_dir().join("transcoding_image_preview_existing_avif");
        let _ = fs::create_dir_all(&dir);

        let png = dir.join("sample.png");
        let avif = dir.join("sample.avif");

        // Create a small PNG and a sibling AVIF file.
        {
            let mut f =
                File::create(&png).unwrap_or_else(|_| panic!("create png {}", png.display()));
            f.write_all(&vec![0u8; 4 * 1024])
                .unwrap_or_else(|_| panic!("write png {}", png.display()));
        }
        {
            let mut f =
                File::create(&avif).unwrap_or_else(|_| panic!("create avif {}", avif.display()));
            f.write_all(b"avif-data")
                .unwrap_or_else(|_| panic!("write avif {}", avif.display()));
        }

        let engine = make_engine_with_preset();

        let settings = {
            let state = engine.inner.state.lock().expect("engine state poisoned");
            state.settings.clone()
        };

        let config = SmartScanConfig {
            min_image_size_kb: 1,      // treat the tiny PNG as a valid candidate
            min_video_size_mb: 10_000, // unused here
            min_saving_ratio: 0.95,
            image_target_format: ImageTargetFormat::Avif,
            video_preset_id: "preset-1".to_string(),
        };

        let job = engine
            .handle_image_file(&png, &config, &settings, "batch-image-preview")
            .expect("handle_image_file should succeed with existing AVIF sibling");

        assert_eq!(
            job.status,
            JobStatus::Skipped,
            "existing AVIF sibling should cause image job to be skipped"
        );
        assert_eq!(
            job.skip_reason.as_deref(),
            Some("Existing .avif sibling"),
            "skip reason should explain that an AVIF sibling already exists"
        );

        let preview = job.preview_path.as_deref().unwrap_or_default();
        assert!(
            preview.ends_with(".avif"),
            "preview_path should point to the existing AVIF sibling, got {preview}"
        );

        let _ = fs::remove_file(&png);
        let _ = fs::remove_file(&avif);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_auto_compress_emits_monotonic_progress_and_matches_summary() {
        let dir = env::temp_dir().join("transcoding_smart_scan_progress");
        let _ = fs::create_dir_all(&dir);

        let image1 = dir.join("small1.jpg");
        let image2 = dir.join("small2.png");
        let video1 = dir.join("small1.mp4");

        for path in [&image1, &image2, &video1] {
            let mut file = File::create(path)
                .unwrap_or_else(|_| panic!("create test file {}", path.display()));
            let data = vec![0u8; 4 * 1024];
            file.write_all(&data)
                .unwrap_or_else(|_| panic!("write data for {}", path.display()));
        }

        let engine = make_engine_with_preset();

        let snapshots: TestArc<TestMutex<Vec<AutoCompressProgress>>> =
            TestArc::new(TestMutex::new(Vec::new()));
        let snapshots_clone = TestArc::clone(&snapshots);

        engine.register_smart_scan_listener(move |progress: AutoCompressProgress| {
            snapshots_clone
                .lock()
                .expect("snapshots lock poisoned")
                .push(progress);
        });

        let config = SmartScanConfig {
            min_image_size_kb: 10_000,
            min_video_size_mb: 10_000,
            min_saving_ratio: 0.95,
            image_target_format: ImageTargetFormat::Avif,
            video_preset_id: "preset-1".to_string(),
        };

        let root_path = dir.to_string_lossy().into_owned();
        let descriptor = engine
            .run_auto_compress(root_path.clone(), config)
            .expect("run_auto_compress should succeed for synthetic tree");

        let batch_id = descriptor.batch_id.clone();

        // 等待后台 Smart Scan 批次完成，最多轮询约 5 秒。
        let summary = {
            let mut attempts = 0;
            loop {
                if let Some(summary) = engine.smart_scan_batch_summary(&batch_id) {
                    if summary.total_files_scanned >= 3
                        && summary.total_candidates >= 3
                        && summary.total_processed >= 3
                    {
                        break summary;
                    }
                }
                attempts += 1;
                if attempts > 100 {
                    panic!("Smart Scan batch did not reach expected summary within timeout");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        };

        let snapshots_lock = snapshots.lock().expect("snapshots lock poisoned");
        assert!(
            !snapshots_lock.is_empty(),
            "Smart Scan must emit at least one progress snapshot during run_auto_compress"
        );

        let mut last_scanned = 0u64;
        let mut last_candidates = 0u64;
        let mut last_processed = 0u64;

        for snap in snapshots_lock.iter() {
            assert_eq!(
                snap.root_path, root_path,
                "all progress snapshots must use the same rootPath as the final result"
            );
            assert!(
                snap.total_files_scanned >= last_scanned,
                "total_files_scanned must be monotonic (prev={last_scanned}, current={})",
                snap.total_files_scanned
            );
            assert!(
                snap.total_candidates >= last_candidates,
                "total_candidates must be monotonic (prev={last_candidates}, current={})",
                snap.total_candidates
            );
            assert!(
                snap.total_processed >= last_processed,
                "total_processed must be monotonic (prev={last_processed}, current={})",
                snap.total_processed
            );
            last_scanned = snap.total_files_scanned;
            last_candidates = snap.total_candidates;
            last_processed = snap.total_processed;
        }

        assert_eq!(
            last_scanned, summary.total_files_scanned,
            "final progress snapshot total_files_scanned must match Smart Scan batch summary"
        );
        assert_eq!(
            last_candidates, summary.total_candidates,
            "final progress snapshot total_candidates must match Smart Scan batch summary"
        );
        assert_eq!(
            last_processed, summary.total_processed,
            "final progress snapshot total_processed must match Smart Scan batch summary"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_auto_compress_progress_listener_can_call_queue_state_without_deadlock() {
        let dir = env::temp_dir().join("transcoding_smart_scan_lock_free");
        let _ = fs::create_dir_all(&dir);

        let video = dir.join("sample_lock_free.mp4");
        {
            let mut file = File::create(&video)
                .unwrap_or_else(|_| panic!("create lock-free test file {}", video.display()));
            let data = vec![0u8; 4 * 1024];
            file.write_all(&data).unwrap_or_else(|_| {
                panic!("write data for lock-free test file {}", video.display())
            });
        }

        let engine = make_engine_with_preset();
        let engine_clone = engine.clone();

        let snapshots: TestArc<TestMutex<Vec<AutoCompressProgress>>> =
            TestArc::new(TestMutex::new(Vec::new()));
        let snapshots_clone = TestArc::clone(&snapshots);

        // If run_auto_compress ever holds the engine state lock while notifying
        // listeners, calling queue_state() from inside the listener would
        // deadlock. This test ensures the implementation remains lock-free for
        // progress notifications.
        engine.register_smart_scan_listener(move |progress: AutoCompressProgress| {
            let _ = engine_clone.queue_state();
            snapshots_clone
                .lock()
                .expect("snapshots lock poisoned")
                .push(progress);
        });

        let config = SmartScanConfig {
            min_image_size_kb: 10_000,
            min_video_size_mb: 10_000,
            min_saving_ratio: 0.95,
            image_target_format: ImageTargetFormat::Avif,
            video_preset_id: "preset-1".to_string(),
        };

        let root_path = dir.to_string_lossy().into_owned();
        let descriptor = engine
            .run_auto_compress(root_path.clone(), config)
            .expect("run_auto_compress should succeed for lock-free listener test");

        let batch_id = descriptor.batch_id.clone();

        // 等待批次完成以便能够读取稳定的汇总信息。
        let summary = {
            let mut attempts = 0;
            loop {
                if let Some(summary) = engine.smart_scan_batch_summary(&batch_id) {
                    if summary.total_files_scanned >= 1 {
                        break summary;
                    }
                }
                attempts += 1;
                if attempts > 100 {
                    panic!("Smart Scan batch did not finish within timeout in lock-free test");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        };

        let snapshots_lock = snapshots.lock().expect("snapshots lock poisoned");
        assert!(
            !snapshots_lock.is_empty(),
            "Smart Scan progress listener should have been invoked at least once"
        );

        assert_eq!(
            summary.total_files_scanned, 1,
            "lock-free test tree contains exactly one file"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smart_scan_video_output_naming_avoids_overwrites() {
        let dir = env::temp_dir().join("transcoding_smart_scan_safe_outputs");
        let _ = fs::create_dir_all(&dir);

        let input = dir.join("sample.mp4");
        {
            let mut file =
                File::create(&input).expect("create input video file for safe output test");
            file.write_all(&[0u8; 1024])
                .expect("write input data for safe output test");
        }

        let existing1 = dir.join("sample.compressed.mp4");
        let existing2 = dir.join("sample.compressed (1).mp4");

        for path in [&existing1, &existing2] {
            let mut file = File::create(path)
                .unwrap_or_else(|_| panic!("create existing output {}", path.display()));
            file.write_all(b"existing-output")
                .unwrap_or_else(|_| panic!("write existing output {}", path.display()));
        }

        let presets = vec![make_test_preset()];
        let settings = AppSettings::default();
        let mut state = EngineState::new(presets, settings);

        // Simulate outputs from a previous Smart Scan run.
        state
            .known_smart_scan_outputs
            .insert(existing1.to_string_lossy().into_owned());
        state
            .known_smart_scan_outputs
            .insert(existing2.to_string_lossy().into_owned());

        let first = reserve_unique_smart_scan_video_output_path(&mut state, &input);
        assert_ne!(
            first, existing1,
            "first Smart Scan output path must not overwrite pre-existing sample.compressed.mp4"
        );
        assert_ne!(
            first, existing2,
            "first Smart Scan output path must not overwrite pre-existing sample.compressed (1).mp4"
        );

        let second = reserve_unique_smart_scan_video_output_path(&mut state, &input);
        assert_ne!(
            second, first,
            "subsequent Smart Scan output path must differ from previously reserved path"
        );
        assert_ne!(
            second, existing1,
            "second Smart Scan output path must not overwrite pre-existing outputs"
        );
        assert_ne!(
            second, existing2,
            "second Smart Scan output path must not overwrite pre-existing outputs"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn smart_scan_does_not_reenqueue_known_outputs_as_candidates() {
        let dir = env::temp_dir().join("transcoding_smart_scan_dedup");
        let _ = fs::create_dir_all(&dir);

        let input = dir.join("video.mp4");
        let output = dir.join("video.compressed.mp4");

        for path in [&input, &output] {
            let mut file = File::create(path)
                .unwrap_or_else(|_| panic!("create test file {}", path.display()));
            file.write_all(&[0u8; 1024])
                .unwrap_or_else(|_| panic!("write data for {}", path.display()));
        }

        let engine = make_engine_with_preset();

        // Simulate that `output` is a known Smart Scan output from a previous run.
        register_known_smart_scan_output_with_inner(&engine.inner, &output);

        // A known output path should always be treated as "skip as candidate".
        let output_is_known = is_known_smart_scan_output_with_inner(&engine.inner, &output)
            || is_smart_scan_style_output(&output);
        assert!(
            output_is_known,
            "Smart Scan must treat video.compressed.mp4 as a known output when evaluating candidates"
        );

        // The original input path must remain eligible as a candidate.
        let input_is_known = is_known_smart_scan_output_with_inner(&engine.inner, &input)
            || is_smart_scan_style_output(&input);
        assert!(
            !input_is_known,
            "original input video.mp4 must not be treated as a known output and must remain eligible"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compute_preview_seek_seconds_uses_capture_percent_with_clamping() {
        // Normal case: 25% of a 200s clip -> 50s.
        let seek = compute_preview_seek_seconds(Some(200.0), 25);
        assert!(
            (seek - 50.0).abs() < 0.001,
            "expected seek around 50s for 25% of 200s, got {seek}"
        );

        // Very low percent clamps to at least 1s.
        let seek_low = compute_preview_seek_seconds(Some(200.0), 0);
        assert!(
            (seek_low - 1.0).abs() < 0.001,
            "seek should clamp to >= 1s when percent is 0, got {seek_low}"
        );

        // Very high percent clamps to at most duration - 1s.
        let seek_high = compute_preview_seek_seconds(Some(200.0), 100);
        assert!(
            (seek_high - 199.0).abs() < 0.001,
            "seek should clamp to <= duration-1s, expected ~199, got {seek_high}"
        );
    }

    #[test]
    fn compute_preview_seek_seconds_falls_back_when_duration_unavailable() {
        let seek_none = compute_preview_seek_seconds(None, 25);
        assert!(
            (seek_none - 3.0).abs() < 0.001,
            "missing duration should fall back to default 3s, got {seek_none}"
        );

        let seek_zero = compute_preview_seek_seconds(Some(0.0), 25);
        assert!(
            (seek_zero - 3.0).abs() < 0.001,
            "zero duration should fall back to default 3s, got {seek_zero}"
        );
    }

    #[test]
    fn compute_preview_seek_seconds_handles_very_short_clips() {
        // For very short clips we use a simple midpoint rather than 1..D-1.
        let seek_short = compute_preview_seek_seconds(Some(1.0), 25);
        assert!(
            (seek_short - 0.5).abs() < 0.001,
            "very short clips should use a midpoint (~0.5s for 1s clip), got {seek_short}"
        );
    }

    #[test]
    fn parse_ffmpeg_time_to_seconds_handles_hms_with_fraction() {
        let v = parse_ffmpeg_time_to_seconds("00:01:29.95");
        assert!((v - 89.95).abs() < 0.001);
    }

    #[test]
    fn parse_ffmpeg_duration_from_metadata_line_extracts_duration() {
        let line = "  Duration: 00:01:29.95, start: 0.000000, bitrate: 20814 kb/s";
        let seconds =
            parse_ffmpeg_duration_from_metadata_line(line).expect("duration should be parsed");
        assert!((seconds - 89.95).abs() < 0.001);

        let unrelated = "Some other log line without duration";
        assert!(parse_ffmpeg_duration_from_metadata_line(unrelated).is_none());
    }

    #[test]
    fn parse_ffmpeg_progress_line_extracts_elapsed_and_speed() {
        let line = "frame=  899 fps=174 q=29.0 size=   12800KiB time=00:00:32.51 bitrate=3224.5kbits/s speed=6.29x elapsed=0:00:05.17";
        let (elapsed, speed) = parse_ffmpeg_progress_line(line).expect("progress should be parsed");
        assert!((elapsed - 32.51).abs() < 0.001);
        assert!((speed.unwrap() - 6.29).abs() < 0.001);
    }

    #[test]
    fn parse_ffmpeg_progress_line_handles_out_time_and_out_time_ms() {
        // Simulate a minimal `-progress pipe:2` style block.
        let lines = ["frame=10", "out_time_ms=820000", "out_time=00:00:00.820000"];

        let mut last: Option<(f64, Option<f64>)> = None;
        for line in &lines {
            if let Some(sample) = parse_ffmpeg_progress_line(line) {
                last = Some(sample);
            }
        }

        let (elapsed, speed) = last.expect("structured progress should be parsed");
        assert!(
            (elapsed - 0.82).abs() < 0.001,
            "elapsed seconds should be derived from out_time, got {elapsed}"
        );
        assert!(
            speed.is_none(),
            "structured progress lines without an inline speed token should leave speed unset"
        );

        // Also accept a bare out_time_ms line when out_time is missing.
        let (elapsed_ms, _) = parse_ffmpeg_progress_line("out_time_ms=1234567")
            .expect("ms-only progress should parse");
        assert!(
            (elapsed_ms - 1.234_567).abs() < 0.001,
            "out_time_ms (microseconds) should be converted to seconds, got {elapsed_ms}"
        );
    }

    #[test]
    fn is_ffmpeg_progress_end_detects_end_marker() {
        assert!(!is_ffmpeg_progress_end("progress=continue"));
        assert!(is_ffmpeg_progress_end("progress=end"));
        assert!(is_ffmpeg_progress_end("   progress=END   "));
        assert!(!is_ffmpeg_progress_end(
            "some other line without progress token"
        ));
    }

    #[test]
    fn parse_ffprobe_frame_rate_handles_fraction_and_integer() {
        let frac = parse_ffprobe_frame_rate("30000/1001")
            .expect("30000/1001 should parse as a valid frame rate");
        assert!((frac - 29.97).abs() < 0.01);

        let int = parse_ffprobe_frame_rate("24").expect("integer frame rate should parse");
        assert!((int - 24.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_ffprobe_frame_rate_rejects_invalid_or_empty_tokens() {
        assert!(parse_ffprobe_frame_rate("").is_none());
        assert!(parse_ffprobe_frame_rate("0/0").is_none());
        assert!(parse_ffprobe_frame_rate("not-a-number").is_none());
    }

    #[test]
    fn compute_progress_percent_for_known_duration_uses_elapsed_ratio() {
        let total = Some(100.0);
        let samples = [
            (0.0, 0.0),
            (1.0, 1.0),
            (25.0, 25.0),
            (50.0, 50.0),
            (75.0, 75.0),
            (100.0, 100.0),
        ];
        for &(elapsed, expected) in &samples {
            let p = compute_progress_percent(total, elapsed);
            assert!(
                (p - expected).abs() < 0.001,
                "expected progress ~= {expected} for elapsed {elapsed}, got {p}"
            );
        }

        // Elapsed time beyond the nominal duration should not exceed 100%.
        let p_over = compute_progress_percent(total, 150.0);
        assert!(
            (p_over - 100.0).abs() < 0.001,
            "elapsed beyond duration should clamp to 100, got {p_over}"
        );
    }

    #[test]
    fn compute_progress_percent_for_unknown_duration_returns_zero() {
        let samples = [0.0, 1.0, 5.0, 10.0, 30.0, 60.0, 120.0];
        for &t in &samples {
            let p = compute_progress_percent(None, t);
            assert!(
                (p - 0.0).abs() < f64::EPSILON,
                "unknown duration should not invent a fake percentage, expected 0, got {p}"
            );
        }
    }

    #[test]
    fn update_job_progress_clamps_and_is_monotonic() {
        let settings = AppSettings::default();
        let inner = Inner::new(Vec::new(), settings);
        let job_id = "job-progress-monotonic".to_string();

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.jobs.insert(
                job_id.clone(),
                TranscodeJob {
                    id: job_id.clone(),
                    filename: "C:/videos/monotonic.mp4".to_string(),
                    job_type: JobType::Video,
                    source: JobSource::Manual,
                    queue_order: None,
                    original_size_mb: 100.0,
                    original_codec: Some("h264".to_string()),
                    preset_id: "preset-1".to_string(),
                    status: JobStatus::Processing,
                    progress: 0.0,
                    start_time: Some(0),
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
                },
            );
        }

        // Negative percentages clamp to 0 and do not move progress.
        update_job_progress(&inner, &job_id, Some(-10.0), None, None);

        {
            let state = inner.state.lock().expect("engine state poisoned");
            let job = state
                .jobs
                .get(&job_id)
                .expect("job must be present after first update");
            assert_eq!(job.progress, 0.0);
        }

        // Normal in-range percentage moves progress forward.
        update_job_progress(&inner, &job_id, Some(42.5), None, None);

        {
            let state = inner.state.lock().expect("engine state poisoned");
            let job = state
                .jobs
                .get(&job_id)
                .expect("job must be present after second update");
            assert!(
                (job.progress - 42.5).abs() < f64::EPSILON,
                "progress should track the clamped percentage"
            );
        }

        // Values above 100 clamp to 100.
        update_job_progress(&inner, &job_id, Some(150.0), None, None);

        {
            let state = inner.state.lock().expect("engine state poisoned");
            let job = state
                .jobs
                .get(&job_id)
                .expect("job must be present after third update");
            assert_eq!(job.progress, 100.0);
        }

        // Regressing percentages are ignored to keep progress monotonic.
        update_job_progress(&inner, &job_id, Some(80.0), None, None);

        {
            let state = inner.state.lock().expect("engine state poisoned");
            let job = state
                .jobs
                .get(&job_id)
                .expect("job must be present after final update");
            assert_eq!(
                job.progress, 100.0,
                "progress must remain monotonic and never decrease"
            );
        }
    }

    #[test]
    fn update_job_progress_emits_queue_snapshot_for_log_only_updates() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_log_stream.mp4");

        {
            let mut file = File::create(&path).expect("create temp video file for log-stream test");
            let data = vec![0u8; 1024 * 1024];
            file.write_all(&data)
                .expect("write data to temp video file for log-stream test");
        }

        let engine = make_engine_with_preset();

        let snapshots: TestArc<TestMutex<Vec<QueueState>>> =
            TestArc::new(TestMutex::new(Vec::new()));
        let snapshots_clone = TestArc::clone(&snapshots);

        engine.register_queue_listener(move |state: QueueState| {
            snapshots_clone
                .lock()
                .expect("snapshots lock poisoned")
                .push(state);
        });

        let job = engine.enqueue_transcode_job(
            path.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "preset-1".into(),
        );

        // Clear any initial snapshots from enqueue so we can focus on the
        // behaviour of update_job_progress itself.
        {
            let mut states = snapshots.lock().expect("snapshots lock poisoned");
            states.clear();
        }

        // Simulate the worker having moved the job into Processing state, as
        // spawn_worker would normally do before calling process_transcode_job.
        {
            let inner = &engine.inner;
            let mut state = inner.state.lock().expect("engine state poisoned");
            let stored = state
                .jobs
                .get_mut(&job.id)
                .expect("job should be present in engine state");
            stored.status = JobStatus::Processing;
        }

        // Invoke update_job_progress with only a log line and no percentage.
        // This previously failed to emit any queue snapshots, causing the UI
        // to see no live logs or ffmpeg command until some later state change
        // such as cancellation or completion.
        update_job_progress(
            &engine.inner,
            &job.id,
            None,
            Some("ffmpeg test progress line"),
            None,
        );

        let states = snapshots.lock().expect("snapshots lock poisoned");
        assert!(
            !states.is_empty(),
            "log-only progress updates for processing jobs must emit at least one queue snapshot"
        );
        let snapshot_job = states
            .iter()
            .flat_map(|s| s.jobs.iter())
            .find(|j| j.id == job.id)
            .expect("snapshot should contain the updated job");
        assert!(
            snapshot_job
                .logs
                .iter()
                .any(|l| l.contains("ffmpeg test progress line")),
            "snapshot logs should include the newly appended log line"
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn update_job_progress_ignores_whitespace_only_log_lines() {
        let settings = AppSettings::default();
        let inner = Inner::new(Vec::new(), settings);
        let job_id = "job-whitespace-logs".to_string();

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.jobs.insert(
                job_id.clone(),
                TranscodeJob {
                    id: job_id.clone(),
                    filename: "dummy.mp4".to_string(),
                    job_type: JobType::Video,
                    source: JobSource::Manual,
                    queue_order: None,
                    original_size_mb: 100.0,
                    original_codec: Some("h264".to_string()),
                    preset_id: "preset-1".to_string(),
                    status: JobStatus::Processing,
                    progress: 0.0,
                    start_time: Some(0),
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
                },
            );
        }

        // First append a meaningful log line.
        update_job_progress(
            &inner,
            &job_id,
            None,
            Some("ffmpeg test progress line"),
            None,
        );

        // Then feed in whitespace-only lines that should be ignored.
        update_job_progress(&inner, &job_id, None, Some("   "), None);
        update_job_progress(&inner, &job_id, None, Some("\t\t"), None);
        update_job_progress(&inner, &job_id, None, Some(""), None);

        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must be present after whitespace log updates");

        assert_eq!(
            job.logs.len(),
            1,
            "whitespace-only log lines should not be stored in job.logs",
        );
        assert!(
            job.logs[0].contains("ffmpeg test progress line"),
            "the original non-empty log line must be preserved",
        );

        let tail = job.log_tail.as_deref().unwrap_or("");
        assert!(
            tail.contains("ffmpeg test progress line"),
            "log_tail should still reflect the meaningful log content",
        );
    }

    #[test]
    fn process_transcode_job_marks_failure_when_preset_missing() {
        let settings = AppSettings::default();
        let inner = Inner::new(Vec::new(), settings);
        let job_id = "job-missing-preset".to_string();

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.jobs.insert(
                job_id.clone(),
                TranscodeJob {
                    id: job_id.clone(),
                    filename: "C:/videos/sample.mp4".to_string(),
                    job_type: JobType::Video,
                    source: JobSource::Manual,
                    queue_order: None,
                    original_size_mb: 100.0,
                    original_codec: Some("h264".to_string()),
                    preset_id: "non-existent-preset".to_string(),
                    status: JobStatus::Processing,
                    progress: 0.0,
                    start_time: Some(0),
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
                },
            );
        }

        let result = process_transcode_job(&inner, &job_id);
        assert!(
            result.is_ok(),
            "processing a job with a missing preset should not bubble an error"
        );

        let state = inner.state.lock().expect("engine state poisoned");
        let job = state
            .jobs
            .get(&job_id)
            .expect("job must remain present after processing");
        assert_eq!(job.status, JobStatus::Failed);
        assert_eq!(job.progress, 100.0);

        let failure = job.failure_reason.as_ref().expect("failure_reason present");
        assert!(
            failure.contains("No preset found for preset id 'non-existent-preset'"),
            "failure_reason should mention the missing preset id, got: {failure}"
        );
        assert!(
            job.logs
                .iter()
                .any(|line| line.contains("No preset found for preset id 'non-existent-preset'")),
            "logs should contain the missing preset message"
        );
    }

    #[test]
    fn queue_listener_observes_enqueue_and_cancel() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_listener.mp4");

        {
            let mut file = File::create(&path).expect("create temp video file for listener test");
            let data = vec![0u8; 1024 * 1024];
            file.write_all(&data)
                .expect("write data to temp video file for listener test");
        }

        let engine = make_engine_with_preset();

        let snapshots: TestArc<TestMutex<Vec<QueueState>>> =
            TestArc::new(TestMutex::new(Vec::new()));
        let snapshots_clone = TestArc::clone(&snapshots);

        engine.register_queue_listener(move |state: QueueState| {
            snapshots_clone
                .lock()
                .expect("snapshots lock poisoned")
                .push(state);
        });

        let job = engine.enqueue_transcode_job(
            path.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "preset-1".into(),
        );

        {
            let states = snapshots.lock().expect("snapshots lock poisoned");
            assert!(
                states.iter().any(|s| s.jobs.iter().any(|j| j.id == job.id)),
                "listener should receive a snapshot containing the enqueued job"
            );
        }

        let cancelled = engine.cancel_job(&job.id);
        assert!(cancelled, "cancel_job should succeed for enqueued job");

        {
            let states = snapshots.lock().expect("snapshots lock poisoned");
            assert!(
                states.iter().any(|s| s
                    .jobs
                    .iter()
                    .any(|j| j.id == job.id && j.status == JobStatus::Cancelled)),
                "listener should receive a snapshot containing the cancelled job"
            );
        }

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn queue_state_exposes_stable_queue_order_for_waiting_jobs() {
        let engine = make_engine_with_preset();

        let first = engine.enqueue_transcode_job(
            "C:/videos/order-1.mp4".to_string(),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );
        let second = engine.enqueue_transcode_job(
            "C:/videos/order-2.mp4".to_string(),
            JobType::Video,
            JobSource::Manual,
            100.0,
            Some("h264".into()),
            "preset-1".into(),
        );

        // Both jobs are in the waiting queue; queue_state should assign them
        // deterministic queueOrder values based on the in-memory queue.
        let state = engine.queue_state();
        let mut by_id = std::collections::HashMap::new();
        for job in state.jobs {
            by_id.insert(job.id.clone(), job);
        }

        let j1 = by_id.get(&first.id).expect("first job present in queue_state");
        let j2 = by_id
            .get(&second.id)
            .expect("second job present in queue_state");

        assert_eq!(
            j1.queue_order,
            Some(0),
            "first enqueued job should have queueOrder 0"
        );
        assert_eq!(
            j2.queue_order,
            Some(1),
            "second enqueued job should have queueOrder 1"
        );

        // Simulate a worker taking the first job; it should no longer appear
        // in the scheduling queue, and subsequent snapshots should clear its
        // queueOrder while leaving the second job untouched.
        {
            let mut state_inner = engine
                .inner
                .state
                .lock()
                .expect("engine state poisoned for queueOrder test");
            let popped = state_inner.queue.pop_front();
            assert_eq!(
                popped,
                Some(first.id.clone()),
                "front of queue must be the first enqueued job"
            );
        }

        let state_after = engine.queue_state();
        let mut by_id_after = std::collections::HashMap::new();
        for job in state_after.jobs {
            by_id_after.insert(job.id.clone(), job);
        }

        let j1_after = by_id_after
            .get(&first.id)
            .expect("first job still present after dequeue");
        let j2_after = by_id_after
            .get(&second.id)
            .expect("second job still present after dequeue");

        assert!(
            j1_after.queue_order.is_none(),
            "job no longer in the waiting queue should not carry a queueOrder"
        );
        assert_eq!(
            j2_after.queue_order,
            Some(0),
            "remaining waiting job should shift to queueOrder 0"
        );
    }
}
