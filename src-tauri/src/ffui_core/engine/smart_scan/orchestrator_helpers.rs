use std::fs;
use std::path::Path;

use crate::ffui_core::domain::{
    JobSource, JobStatus, JobType, MediaInfo, SmartScanConfig, TranscodeJob,
};

use super::super::state::Inner;
use super::helpers::current_time_millis;

pub(super) fn insert_image_stub_job(
    inner: &Inner,
    job_id: &str,
    path: &Path,
    config: &SmartScanConfig,
    batch_id: &str,
) {
    let original_size_mb = fs::metadata(path)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(0.0);

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let job = TranscodeJob {
        id: job_id.to_string(),
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
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(path.to_string_lossy().into_owned()),
        output_path: None,
        output_policy: Some(config.output_policy.clone()),
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
        warnings: Vec::new(),
        batch_id: Some(batch_id.to_string()),
        wait_metadata: None,
    };

    let mut state = inner.state.lock().expect("engine state poisoned");
    state.jobs.insert(job_id.to_string(), job);
}

pub(super) fn insert_audio_stub_job(
    inner: &Inner,
    job_id: &str,
    path: &Path,
    config: &SmartScanConfig,
    batch_id: &str,
) {
    let original_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());

    let job = TranscodeJob {
        id: job_id.to_string(),
        filename,
        job_type: JobType::Audio,
        source: JobSource::SmartScan,
        queue_order: None,
        original_size_mb,
        original_codec: ext,
        preset_id: config.audio_preset_id.clone().unwrap_or_default(),
        status: JobStatus::Waiting,
        progress: 0.0,
        start_time: None,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(path.to_string_lossy().into_owned()),
        output_path: None,
        output_policy: Some(config.output_policy.clone()),
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
        warnings: Vec::new(),
        batch_id: Some(batch_id.to_string()),
        wait_metadata: None,
    };

    let mut state = inner.state.lock().expect("engine state poisoned");
    state.jobs.insert(job_id.to_string(), job);
}

pub(super) fn set_job_processing(inner: &Inner, job_id: &str) {
    let mut state = inner.state.lock().expect("engine state poisoned");
    if let Some(job) = state.jobs.get_mut(job_id) {
        job.status = JobStatus::Processing;
        job.start_time.get_or_insert(current_time_millis());
    }
}
