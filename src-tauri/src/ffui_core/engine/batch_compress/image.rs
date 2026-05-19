use std::fs;
use std::path::Path;

use anyhow::{Context, Result};

use super::super::output_policy_paths::plan_output_path_with_extension;
use super::super::state::{Inner, register_known_batch_compress_output_with_inner};
use super::helpers::{
    capture_input_times_if_needed, make_batch_compress_job, next_job_id,
    replace_original_output_policy,
};
use super::image_encode_avif::{encode_image_to_avif, encode_image_to_webp};
use crate::ffui_core::domain::{
    BatchCompressConfig, ImageTargetFormat, JobStatus, JobType, TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::sync_ext::MutexExt;

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

    let resolved_job_id = job_id.unwrap_or_else(|| next_job_id(inner));
    let original_codec = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let mut job = make_batch_compress_job(super::helpers::BatchCompressJobSpec {
        job_id: resolved_job_id,
        filename,
        job_type: JobType::Image,
        preset_id: config.video_preset_id.clone(),
        original_size_mb,
        original_codec,
        input_path: path.to_string_lossy().into_owned(),
        output_policy: replace_original_output_policy(config),
        batch_id: batch_id.to_string(),
        saving_condition: config.into(),
        start_time: None,
    });

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    let preserve_times_policy = config.output_policy.preserve_file_times.clone();
    let input_times = capture_input_times_if_needed(path, &preserve_times_policy);

    let target_ext = match config.image_target_format {
        ImageTargetFormat::Avif => "avif",
        ImageTargetFormat::Webp => "webp",
    };
    let target_label = target_ext.to_ascii_uppercase();

    if ext == target_ext {
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some(format!("Already {target_label}"));
        return Ok(job);
    }

    if original_size_bytes < config.min_image_size_kb * 1024 {
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some(format!("Size < {}KB", config.min_image_size_kb));
        return Ok(job);
    }

    // Back-compat: when an `input-stem.<target>` sibling already exists next to the source image,
    // treat it as already-compressed and skip regardless of output naming policy.
    let sibling_target = path.with_extension(target_ext);
    if sibling_target.exists() {
        register_known_batch_compress_output_with_inner(inner, &sibling_target);
        job.output_path = Some(sibling_target.to_string_lossy().into_owned());
        job.preview_path = Some(sibling_target.to_string_lossy().into_owned());
        job.preview_revision = job.preview_revision.saturating_add(1);
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some(format!("Existing .{target_ext} sibling"));
        return Ok(job);
    }

    // Compute output path based on Batch Compress output policy (extension is driven by image target
    // format).
    let image_target = {
        let mut state = inner.state.lock_unpoisoned();
        let policy = replace_original_output_policy(config);
        let target =
            plan_output_path_with_extension(path, target_ext, None, &policy, |candidate| {
                let s = candidate.to_string_lossy();
                candidate.exists() || state.known_batch_compress_outputs.contains(s.as_ref())
            });
        state
            .known_batch_compress_outputs
            .insert(target.to_string_lossy().into_owned());
        target
    };
    let tmp_output = {
        let stem = image_target
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        let ext = image_target
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or(target_ext);
        image_target
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{stem}.tmp.{ext}"))
    };
    if image_target.exists() {
        // Treat existing target image as a known Batch Compress output so future
        // batches can reliably skip it as a candidate.
        register_known_batch_compress_output_with_inner(inner, &image_target);

        // Prefer the existing target sibling as the preview surface so the UI
        // can show the final compressed result instead of the original PNG.
        job.output_path = Some(image_target.to_string_lossy().into_owned());
        job.preview_path = Some(image_target.to_string_lossy().into_owned());
        job.preview_revision = job.preview_revision.saturating_add(1);
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some(format!("Existing .{target_ext} sibling"));
        return Ok(job);
    }

    let ctx = super::image_encode_avif::AvifEncodeContext {
        inner,
        config,
        settings,
        original_size_bytes,
        preserve_times_policy: &preserve_times_policy,
        input_times: input_times.as_ref(),
    };
    match config.image_target_format {
        ImageTargetFormat::Avif => {
            encode_image_to_avif(path, &ctx, &image_target, &tmp_output, &mut job)?;
        }
        ImageTargetFormat::Webp => {
            encode_image_to_webp(path, &ctx, &image_target, &tmp_output, &mut job)?;
        }
    }

    Ok(job)
}
