use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use crate::ffui_core::domain::{JobSource, JobStatus, JobType, MediaInfo, TranscodeJob};

use super::super::ffmpeg_args::infer_output_extension;
use super::super::state::{Inner, notify_queue_listeners};
use super::super::worker_utils::{current_time_millis, estimate_job_seconds_for_preset};

/// Enqueue a new transcode job with computed metadata and queue it.
pub(in crate::ffui_core::engine) fn enqueue_transcode_job(
    inner: &Arc<Inner>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> TranscodeJob {
    let id = {
        let next_id = inner.next_job_id.fetch_add(1, Ordering::SeqCst);
        format!("job-{next_id}")
    };

    let now_ms = current_time_millis();

    let input_path = filename.clone();

    // Prefer a backend-derived size based on the actual file on disk; fall back
    // to the caller-provided value if metadata is unavailable.
    let computed_original_size_mb = fs::metadata(&filename)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(original_size_mb);

    let codec_for_job = original_codec.clone();

    let job = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let estimated_seconds = state
            .presets
            .iter()
            .find(|p| p.id == preset_id)
            .and_then(|p| estimate_job_seconds_for_preset(computed_original_size_mb, p));
        let output_path = if matches!(job_type, JobType::Video) {
            let path = PathBuf::from(&filename);
            let container_format = state
                .presets
                .iter()
                .find(|p| p.id == preset_id)
                .and_then(|p| p.container.as_ref())
                .and_then(|c| c.format.as_deref());
            let input_ext = path.extension().and_then(|e| e.to_str());
            let ext = infer_output_extension(container_format, input_ext);

            let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("output");
            Some(
                parent
                    .join(format!("{stem}.compressed.{ext}"))
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        };
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
    inner.cv.notify_one();
    notify_queue_listeners(inner);
    job
}
