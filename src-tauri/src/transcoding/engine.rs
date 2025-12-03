use std::collections::{hash_map::DefaultHasher, HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use crate::transcoding::domain::{
    AutoCompressResult, JobSource, JobStatus, JobType, MediaInfo, QueueState, SmartScanConfig,
    TranscodeJob,
};
use crate::transcoding::monitor::{
    sample_cpu_usage, sample_gpu_usage, CpuUsageSnapshot, GpuUsageSnapshot,
};
use crate::transcoding::settings::{self, AppSettings};
use crate::transcoding::tools::{
    ensure_tool_available, tool_status, ExternalToolKind, ExternalToolStatus,
};

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

struct EngineState {
    presets: Vec<FFmpegPreset>,
    settings: AppSettings,
    jobs: HashMap<String, TranscodeJob>,
    queue: VecDeque<String>,
    active_job: Option<String>,
    cancelled_jobs: HashSet<String>,
    // Per-input media metadata cache keyed by absolute input path. This avoids
    // repeated ffprobe calls when the same file is reused across jobs.
    media_info_cache: HashMap<String, MediaInfo>,
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
            media_info_cache: HashMap::new(),
        }
    }
}

struct Inner {
    state: Mutex<EngineState>,
    cv: Condvar,
    next_job_id: AtomicU64,
    queue_listeners: Mutex<Vec<QueueListener>>,
}

impl Inner {
    fn new(presets: Vec<FFmpegPreset>, settings: AppSettings) -> Self {
        Self {
            state: Mutex::new(EngineState::new(presets, settings)),
            cv: Condvar::new(),
            next_job_id: AtomicU64::new(1),
            queue_listeners: Mutex::new(Vec::new()),
        }
    }
}

#[derive(Clone)]
pub struct TranscodingEngine {
    inner: Arc<Inner>,
}

fn snapshot_queue_state(inner: &Inner) -> QueueState {
    let state = inner.state.lock().expect("engine state poisoned");
    QueueState {
        jobs: state.jobs.values().cloned().collect(),
    }
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
            Some(build_video_output_path(&path).to_string_lossy().into_owned())
        } else {
            None
        };

        let codec_for_job = original_codec.clone();

        let job = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            let job = TranscodeJob {
                id: id.clone(),
                filename,
                job_type,
                source,
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
                preview_path: None,
                log_tail: None,
                failure_reason: None,
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

        let (settings_snapshot, presets) = {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            state.settings.smart_scan_defaults = config.clone();
            settings::save_settings(&state.settings)?;
            (state.settings.clone(), state.presets.clone())
        };

        let mut jobs = Vec::new();
        let mut total_files_scanned = 0u64;
        let mut total_candidates = 0u64;
        let mut total_processed = 0u64;

        let mut stack = vec![root];

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
                    continue;
                }

                total_files_scanned += 1;

                if is_image_file(&path) {
                    total_candidates += 1;
                    let job = self.handle_image_file(&path, &config, &settings_snapshot)?;
                    if matches!(job.status, JobStatus::Completed) {
                        total_processed += 1;
                    }
                    jobs.push(job);
                } else if is_video_file(&path) {
                    total_candidates += 1;
                    let preset = presets
                        .iter()
                        .find(|p| p.id == config.video_preset_id)
                        .cloned();
                    let job = self.handle_video_file(&path, &config, &settings_snapshot, preset)?;
                    if matches!(job.status, JobStatus::Completed) {
                        total_processed += 1;
                    }
                    jobs.push(job);
                }
            }
        }

        Ok(AutoCompressResult {
            root_path,
            jobs,
            total_files_scanned,
            total_candidates,
            total_processed,
        })
    }

    pub fn inspect_media(&self, path: String) -> Result<String> {
        let settings_snapshot = {
            let state = self.inner.state.lock().expect("engine state poisoned");
            state.settings.clone()
        };

        let (ffprobe_path, _) =
            ensure_tool_available(ExternalToolKind::Ffprobe, &settings_snapshot.tools)?;

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

impl TranscodingEngine {
    fn spawn_worker(inner: Arc<Inner>) {
        // Simple single-worker queue: jobs are processed one at a time in the
        // order they were enqueued. This keeps behavior predictable while still
        // enabling true background processing and cancellation.
        thread::spawn(move || loop {
            let job_id = {
                let mut state = inner.state.lock().expect("engine state poisoned");
                while state.queue.is_empty() {
                    state = inner.cv.wait(state).expect("engine state poisoned");
                }
                let job_id = match state.queue.pop_front() {
                    Some(id) => id,
                    None => continue,
                };
                state.active_job = Some(job_id.clone());
                // Mark the job as processing if it still exists.
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Processing;
                    if job.start_time.is_none() {
                        job.start_time = Some(current_time_millis());
                    }
                    job.progress = 0.0;
                }
                job_id
            };

            // Notify listeners that a job has moved into processing state.
            notify_queue_listeners(&inner);

            if let Err(err) = process_transcode_job(&inner, &job_id) {
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

            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                state.active_job = None;
                state.cancelled_jobs.remove(&job_id);
            }

            // Broadcast final state for the completed / failed / skipped job.
            notify_queue_listeners(&inner);
        });
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
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            job.skip_reason =
                Some("Only video jobs are processed by the ffmpeg worker".to_string());
        }
        return Ok(());
    }

    let preset = match preset {
        Some(p) => p,
        None => {
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
            return Ok(());
        }
    };

    // Ensure ffmpeg is available, honoring auto-download / update settings.
    let (ffmpeg_path, _) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings_snapshot.tools)?;

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

    if media_info.width.is_none()
        || media_info.height.is_none()
        || media_info.frame_rate.is_none()
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

    // Prefer duration from ffprobe when available, but allow the ffmpeg
    // stderr metadata lines (e.g. "Duration: 00:01:29.95, ...") to fill this
    // in later if ffprobe is missing or fails on the current file.
    let mut total_duration = media_info.duration_seconds;

    let output_path = build_video_output_path(&input_path);
    let tmp_output = build_video_tmp_output_path(&input_path);
    let preview_path = generate_preview_for_video(&input_path, &ffmpeg_path);

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
    let args = build_ffmpeg_args(&preset, &input_path, &tmp_output);

    // Record the exact ffmpeg command we are about to run so that users can
    // see and reproduce it from the queue UI if anything goes wrong.
    let ffmpeg_program_for_log = ffmpeg_path.clone();
    log_external_command(inner, job_id, &ffmpeg_program_for_log, &args);

    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
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
                        let mut state =
                            inner.state.lock().expect("engine state poisoned");
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
                let percent = total_duration
                    .map(|total| {
                        if total > 0.0 {
                            ((elapsed / total) * 100.0).min(100.0)
                        } else {
                            0.0
                        }
                    })
                    .unwrap_or(0.0);
                update_job_progress(inner, job_id, Some(percent), Some(&line), speed);
            } else {
                // Non-progress lines are still useful as logs for debugging.
                update_job_progress(inner, job_id, None, Some(&line), None);
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
        let _ = fs::remove_file(&tmp_output);
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

    Ok(())
}

fn is_job_cancelled(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock().expect("engine state poisoned");
    state.cancelled_jobs.contains(job_id)
}

fn mark_job_cancelled(inner: &Inner, job_id: &str) -> Result<()> {
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Cancelled;
            job.progress = 0.0;
            job.end_time = Some(current_time_millis());
            job.logs.push("Cancelled by user".to_string());
            recompute_log_tail(job);
        }
        state.cancelled_jobs.remove(job_id);
    }
    // Notify listeners that the job has transitioned to Cancelled.
    notify_queue_listeners(inner);
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
                let clamped = if p < 0.0 {
                    0.0
                } else if p > 100.0 {
                    100.0
                } else {
                    p
                };
                if clamped > job.progress {
                    job.progress = clamped;
                    should_notify = true;
                }
            }
            if let Some(line) = log_line {
                // Keep only a small rolling window of logs to avoid unbounded growth.
                if job.logs.len() > 200 {
                    job.logs.drain(0..job.logs.len() - 200);
                }
                job.logs.push(line.to_string());
                recompute_log_tail(job);
            }
        }
    }

    // Emit queue snapshots only when progress actually moves forward so the
    // event stream stays efficient while remaining responsive.
    if should_notify {
        notify_queue_listeners(inner);
    }
}

fn detect_duration_seconds(path: &Path, settings: &AppSettings) -> Result<f64> {
    let (ffprobe_path, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
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
        } else if let Some(rest) = token.strip_prefix("speed=") {
            let value = rest.trim_end_matches('x');
            if let Ok(v) = value.parse::<f64>() {
                speed = Some(v);
            }
        }
    }

    elapsed.map(|e| (e, speed))
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
            preview_path: None,
            log_tail: None,
            failure_reason: None,
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
        let avif_target = path.with_extension("avif");
        if avif_target.exists() {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.skip_reason = Some("Existing .avif sibling".to_string());
            return Ok(job);
        }

        let (avifenc_path, _) = ensure_tool_available(ExternalToolKind::Avifenc, &settings.tools)?;

        let tmp_output = avif_target.with_extension("avif.tmp");

        let start_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        job.start_time = Some(start_ms);

        let mut cmd = Command::new(&avifenc_path);
        configure_background_command(&mut cmd);
        let output = cmd
            .arg("--lossless")
            .arg(path.as_os_str())
            .arg(&tmp_output)
            .output()
            .with_context(|| format!("failed to run avifenc on {}", path.display()))?;

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

        fs::rename(&tmp_output, &avif_target).with_context(|| {
            format!(
                "failed to rename {} -> {}",
                tmp_output.display(),
                avif_target.display()
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

    fn handle_video_file(
        &self,
        path: &Path,
        config: &SmartScanConfig,
        settings: &AppSettings,
        preset: Option<FFmpegPreset>,
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
            preview_path: None,
            log_tail: None,
            failure_reason: None,
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

        let (ffmpeg_path, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

        let output_path = build_video_output_path(path);
        let tmp_output = build_video_tmp_output_path(path);

        let args = build_ffmpeg_args(&preset, path, &tmp_output);

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
    let (ffprobe_path, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
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
    let (ffprobe_path, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
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

fn generate_preview_for_video(input: &Path, ffmpeg_path: &str) -> Option<PathBuf> {
    let preview_path = build_preview_output_path(input);

    if preview_path.exists() {
        return Some(preview_path);
    }

    if let Some(parent) = preview_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-ss")
        .arg("3")
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
        recompute_log_tail(job);
    }
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
            return with_output
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
        }
    }

    let mut args: Vec<String> = Vec::new();

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
                super::domain::RateControlMode::Cbr => {}
                super::domain::RateControlMode::Vbr => {}
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
    fn parse_ffmpeg_time_to_seconds_handles_hms_with_fraction() {
        let v = parse_ffmpeg_time_to_seconds("00:01:29.95");
        assert!((v - 89.95).abs() < 0.001);
    }

    #[test]
    fn parse_ffmpeg_duration_from_metadata_line_extracts_duration() {
        let line =
            "  Duration: 00:01:29.95, start: 0.000000, bitrate: 20814 kb/s";
        let seconds = parse_ffmpeg_duration_from_metadata_line(line)
            .expect("duration should be parsed");
        assert!((seconds - 89.95).abs() < 0.001);

        let unrelated = "Some other log line without duration";
        assert!(parse_ffmpeg_duration_from_metadata_line(unrelated).is_none());
    }

    #[test]
    fn parse_ffmpeg_progress_line_extracts_elapsed_and_speed() {
        let line = "frame=  899 fps=174 q=29.0 size=   12800KiB time=00:00:32.51 bitrate=3224.5kbits/s speed=6.29x elapsed=0:00:05.17";
        let (elapsed, speed) =
            parse_ffmpeg_progress_line(line).expect("progress should be parsed");
        assert!((elapsed - 32.51).abs() < 0.001);
        assert!((speed.unwrap() - 6.29).abs() < 0.001);
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
    fn queue_listener_observes_enqueue_and_cancel() {
        let dir = env::temp_dir();
        let path = dir.join("transcoding_test_listener.mp4");

        {
            let mut file =
                File::create(&path).expect("create temp video file for listener test");
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
                states
                    .iter()
                    .any(|s| s.jobs.iter().any(|j| j.id == job.id)),
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
}
