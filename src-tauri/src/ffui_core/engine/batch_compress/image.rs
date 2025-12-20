use std::fs;
use std::path::Path;

use anyhow::{
    Context,
    Result,
};

use super::super::output_policy_paths::plan_output_path_with_extension;
use super::super::state::{
    Inner,
    register_known_batch_compress_output_with_inner,
};
use super::helpers::next_job_id;
use super::image_encode_avif::encode_image_to_avif;
use crate::ffui_core::domain::{
    BatchCompressConfig,
    JobSource,
    JobStatus,
    JobType,
    MediaInfo,
    TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;

#[cfg(test)]
pub(crate) fn handle_image_file(
    inner: &Inner,
    path: &Path,
    config: &BatchCompressConfig,
    settings: &AppSettings,
    batch_id: &str,
) -> Result<TranscodeJob> {
    handle_image_file_with_id(inner, path, config, settings, batch_id, None)
}

pub(crate) fn handle_image_file_with_id(
    inner: &Inner,
    path: &Path,
    config: &BatchCompressConfig,
    settings: &AppSettings,
    batch_id: &str,
    job_id: Option<String>,
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
        id: job_id.unwrap_or_else(|| next_job_id(inner)),
        filename,
        job_type: JobType::Image,
        source: JobSource::BatchCompress,
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
        runs: Vec::new(),
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
        preview_revision: 0,
        log_tail: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: Some(batch_id.to_string()),
        wait_metadata: None,
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let preserve_times_policy = config.output_policy.preserve_file_times.clone();
    let input_times = if preserve_times_policy.any() {
        let mut times = super::super::file_times::read_file_times(path);
        if !preserve_times_policy.created() {
            times.created = None;
        }
        if !preserve_times_policy.modified() {
            times.modified = None;
        }
        if !preserve_times_policy.accessed() {
            times.accessed = None;
        }
        Some(times)
    } else {
        None
    };

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

    // Back-compat: when an `input-stem.avif` sibling already exists next to the source image,
    // treat it as already-compressed and skip regardless of output naming policy.
    let sibling_avif = path.with_extension("avif");
    if sibling_avif.exists() {
        register_known_batch_compress_output_with_inner(inner, &sibling_avif);
        job.output_path = Some(sibling_avif.to_string_lossy().into_owned());
        job.preview_path = Some(sibling_avif.to_string_lossy().into_owned());
        job.preview_revision = job.preview_revision.saturating_add(1);
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some("Existing .avif sibling".to_string());
        return Ok(job);
    }

    // Compute output path based on Batch Compress output policy (extension is driven by image target
    // format). Note: current Batch Compress image pipeline encodes AVIF; `imageTargetFormat` may be
    // extended later.
    let (avif_target, tmp_output) = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let target = plan_output_path_with_extension(
            path,
            "avif",
            None,
            &config.output_policy,
            |candidate| {
                let s = candidate.to_string_lossy();
                candidate.exists() || state.known_batch_compress_outputs.contains(s.as_ref())
            },
        );
        state
            .known_batch_compress_outputs
            .insert(target.to_string_lossy().into_owned());
        let stem = target
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        let ext = target
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("avif");
        let tmp = target
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{stem}.tmp.{ext}"));
        (target, tmp)
    };
    if avif_target.exists() {
        // Treat existing AVIF as a known Batch Compress output so future
        // batches can reliably skip it as a candidate.
        register_known_batch_compress_output_with_inner(inner, &avif_target);

        // Prefer the existing AVIF sibling as the preview surface so the UI
        // can show the final compressed result instead of the original PNG.
        job.output_path = Some(avif_target.to_string_lossy().into_owned());
        job.preview_path = Some(avif_target.to_string_lossy().into_owned());
        job.preview_revision = job.preview_revision.saturating_add(1);
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some("Existing .avif sibling".to_string());
        return Ok(job);
    }

    encode_image_to_avif(
        path,
        super::image_encode_avif::AvifEncodeContext {
            inner,
            config,
            settings,
            original_size_bytes,
            preserve_times_policy: &preserve_times_policy,
            input_times: input_times.as_ref(),
        },
        &avif_target,
        &tmp_output,
        &mut job,
    )?;

    Ok(job)
}
