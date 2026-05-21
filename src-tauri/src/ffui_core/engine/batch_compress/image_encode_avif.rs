use std::fs;
use std::path::Path;

use anyhow::{Context, Result};

use super::super::ffmpeg_args::format_command_for_log;
use super::super::state::{Inner, register_known_batch_compress_output_with_inner};
use super::super::worker_utils::append_job_log_line;
use super::helpers::{
    MediaCommandStopReason, SavingConditionConfig, current_time_millis,
    mark_job_cancelled_from_media_worker, mark_job_paused_from_media_worker, record_tool_download,
    run_killable_command_capture, saving_condition_allows_output, saving_condition_skip_reason,
};
use super::replace_original::finalize_replace_original_output;
use crate::ffui_core::domain::{
    BatchCompressConfig, JobRun, JobStatus, PreserveFileTimesPolicy, TranscodeJob,
};
use crate::ffui_core::engine::file_times::FileTimesSnapshot;
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};

struct FinalizeAvifEncodeSpec<'a> {
    inner: &'a Inner,
    path: &'a Path,
    job: &'a mut TranscodeJob,
    tmp_output: &'a Path,
    image_target: &'a Path,
    original_size_bytes: u64,
    config: &'a BatchCompressConfig,
    preserve_times_policy: &'a PreserveFileTimesPolicy,
    input_times: Option<&'a FileTimesSnapshot>,
    tool_label: &'a str,
    target_label: &'a str,
    lossless: bool,
    set_preview: bool,
}

fn finalize_image_encode(spec: FinalizeAvifEncodeSpec<'_>) -> Result<()> {
    let FinalizeAvifEncodeSpec {
        inner,
        path,
        job,
        tmp_output,
        image_target,
        original_size_bytes,
        config,
        preserve_times_policy,
        input_times,
        tool_label,
        target_label,
        lossless,
        set_preview,
    } = spec;

    let tmp_meta = fs::metadata(tmp_output)
        .with_context(|| format!("failed to stat temp output {}", tmp_output.display()))?;
    let new_size_bytes = tmp_meta.len();
    let condition = SavingConditionConfig::from(config);
    if !saving_condition_allows_output(condition, original_size_bytes, new_size_bytes) {
        drop(fs::remove_file(tmp_output));
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        job.skip_reason = Some(saving_condition_skip_reason(
            condition,
            original_size_bytes,
            new_size_bytes,
        ));
        return Ok(());
    }

    fs::rename(tmp_output, image_target).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_output.display(),
            image_target.display()
        )
    })?;

    let mut final_output_path = image_target.to_path_buf();
    if config.replace_original {
        final_output_path = finalize_replace_original_output(job, path, image_target, "image");
    }

    if preserve_times_policy.any()
        && let Some(times) = input_times
        && let Err(err) = super::super::file_times::apply_file_times(&final_output_path, times)
    {
        append_job_log_line(
            job,
            format!(
                "preserve file times: failed to apply timestamps to {}: {err}",
                final_output_path.display()
            ),
        );
    }

    register_known_batch_compress_output_with_inner(inner, &final_output_path);

    if !matches!(job.status, JobStatus::Failed) {
        job.status = JobStatus::Completed;
    }
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
    job.output_path = Some(final_output_path.to_string_lossy().into_owned());
    if set_preview {
        job.preview_path = Some(final_output_path.to_string_lossy().into_owned());
        job.preview_revision = job.preview_revision.saturating_add(1);
    }

    let output_mb = job.output_size_mb.unwrap_or(0.0);
    let encode_descriptor = if lossless {
        format!("lossless {target_label} encode completed")
    } else {
        format!("{target_label} encode completed")
    };
    let ratio = new_size_bytes as f64 / original_size_bytes as f64;
    append_job_log_line(
        job,
        format!(
            "{tool_label}: {encode_descriptor}; new size {:.2} MB ({:.1}% of original)",
            output_mb,
            ratio * 100.0,
        ),
    );

    Ok(())
}

#[derive(Clone, Copy)]
pub(super) struct AvifEncodeContext<'a> {
    pub inner: &'a Inner,
    pub config: &'a BatchCompressConfig,
    pub settings: &'a AppSettings,
    pub original_size_bytes: u64,
    pub preserve_times_policy: &'a PreserveFileTimesPolicy,
    pub input_times: Option<&'a FileTimesSnapshot>,
}

pub(super) fn encode_image_to_avif(
    path: &Path,
    ctx: &AvifEncodeContext<'_>,
    avif_target: &Path,
    tmp_output: &Path,
    job: &mut TranscodeJob,
) -> Result<()> {
    let AvifEncodeContext {
        inner,
        config,
        settings,
        original_size_bytes,
        preserve_times_policy,
        input_times,
    } = *ctx;

    // Prefer avifenc; if unavailable or encode fails, fall back to ffmpeg.
    let (tried_avifenc, last_error): (bool, Option<anyhow::Error>) = match ensure_tool_available(
        ExternalToolKind::Avifenc,
        &settings.tools,
    ) {
        Ok((avifenc_path, _source, did_download)) => {
            let avifenc_path: String = avifenc_path;

            let avif_args: Vec<String> = vec![
                "--lossless".to_string(),
                "--depth".to_string(),
                "10".to_string(),
                "--yuv".to_string(),
                "444".to_string(),
                // Use CICP (nclx) 1/13/1 as an approximation of sRGB / BT.709.
                "--cicp".to_string(),
                "1/13/1".to_string(),
                // Mark full range explicitly to avoid limited-range mis-detection.
                "--range".to_string(),
                "full".to_string(),
                path.to_string_lossy().into_owned(),
                tmp_output.to_string_lossy().into_owned(),
            ];

            let avif_cmd = format_command_for_log(&avifenc_path, &avif_args);
            job.ffmpeg_command = Some(avif_cmd.clone());
            let start_ms = current_time_millis();
            if job.start_time.is_none() {
                job.start_time = Some(start_ms);
            }
            job.runs.push(JobRun {
                command: avif_cmd.clone(),
                logs: Vec::new(),
                started_at_ms: Some(start_ms),
            });
            if did_download {
                append_job_log_line(
                    job,
                    format!(
                        "auto-download: avifenc was downloaded automatically according to current settings (path: {avifenc_path})"
                    ),
                );
                record_tool_download(inner, ExternalToolKind::Avifenc, &avifenc_path);
            }
            append_job_log_line(job, format!("command: {avif_cmd}"));

            let output = run_killable_command_capture(
                inner,
                &job.id,
                &avifenc_path,
                &avif_args,
                format!("failed to run avifenc on {}", path.display()),
            );

            let last_error = match output {
                Ok(output) if output.stop_reason.is_some() => {
                    match output
                        .stop_reason
                        .expect("stop reason was checked as present")
                    {
                        MediaCommandStopReason::CancelRequested => {
                            mark_job_cancelled_from_media_worker(job, tmp_output);
                        }
                        MediaCommandStopReason::WaitRequested => {
                            mark_job_paused_from_media_worker(job, tmp_output);
                        }
                    }
                    return Ok(());
                }
                Ok(output) if output.status.success() => {
                    finalize_image_encode(FinalizeAvifEncodeSpec {
                        inner,
                        path,
                        job,
                        tmp_output,
                        image_target: avif_target,
                        original_size_bytes,
                        config,
                        preserve_times_policy,
                        input_times,
                        tool_label: "avifenc",
                        target_label: "AVIF",
                        lossless: true,
                        set_preview: true,
                    })?;
                    return Ok(());
                }
                Ok(output) => {
                    append_job_log_line(job, String::from_utf8_lossy(&output.stderr).to_string());
                    drop(fs::remove_file(tmp_output));
                    Some(anyhow::anyhow!(
                        "avifenc exited with non-zero status: {}",
                        output.status
                    ))
                }
                Err(err) => {
                    drop(fs::remove_file(tmp_output));
                    Some(err)
                }
            };

            (true, last_error)
        }
        Err(err) => (false, Some(err)),
    };

    append_job_log_line(
        job,
        match (&last_error, tried_avifenc) {
            (Some(err), true) => {
                format!("avifenc encode failed, falling back to ffmpeg-based AVIF encode: {err:#}")
            }
            (Some(err), false) => format!(
                "avifenc is not available ({err:#}); falling back to ffmpeg-based AVIF encode"
            ),
            (None, _) => "avifenc not used; falling back to ffmpeg-based AVIF encode".to_string(),
        },
    );

    let ffmpeg_args: Vec<String> = vec![
        "-y".to_string(),
        "-i".to_string(),
        path.to_string_lossy().into_owned(),
        "-frames:v".to_string(),
        "1".to_string(),
        "-c:v".to_string(),
        "libaom-av1".to_string(),
        "-still-picture".to_string(),
        "1".to_string(),
        "-pix_fmt".to_string(),
        "yuv444p10le".to_string(),
        "-color_primaries".to_string(),
        "bt709".to_string(),
        "-color_trc".to_string(),
        "iec61966-2-1".to_string(),
        "-colorspace".to_string(),
        "bt709".to_string(),
        "-color_range".to_string(),
        "pc".to_string(),
        tmp_output.to_string_lossy().into_owned(),
    ];

    run_ffmpeg_image_encode(FfmpegImageEncodeSpec {
        path,
        ctx,
        job,
        tmp_output,
        image_target: avif_target,
        ffmpeg_args,
        format_label: "AVIF",
        target_label: "AVIF",
        lossless: false,
        set_preview: false,
    })
}

pub(super) fn encode_image_to_webp(
    path: &Path,
    ctx: &AvifEncodeContext<'_>,
    webp_target: &Path,
    tmp_output: &Path,
    job: &mut TranscodeJob,
) -> Result<()> {
    let ffmpeg_args: Vec<String> = vec![
        "-y".to_string(),
        "-i".to_string(),
        path.to_string_lossy().into_owned(),
        "-frames:v".to_string(),
        "1".to_string(),
        "-c:v".to_string(),
        "libwebp".to_string(),
        "-lossless".to_string(),
        "1".to_string(),
        tmp_output.to_string_lossy().into_owned(),
    ];

    run_ffmpeg_image_encode(FfmpegImageEncodeSpec {
        path,
        ctx,
        job,
        tmp_output,
        image_target: webp_target,
        ffmpeg_args,
        format_label: "WebP",
        target_label: "WebP",
        lossless: true,
        set_preview: true,
    })
}

struct FfmpegImageEncodeSpec<'a> {
    path: &'a Path,
    ctx: &'a AvifEncodeContext<'a>,
    job: &'a mut TranscodeJob,
    tmp_output: &'a Path,
    image_target: &'a Path,
    ffmpeg_args: Vec<String>,
    format_label: &'a str,
    target_label: &'a str,
    lossless: bool,
    set_preview: bool,
}

fn run_ffmpeg_image_encode(spec: FfmpegImageEncodeSpec<'_>) -> Result<()> {
    let FfmpegImageEncodeSpec {
        path,
        ctx,
        job,
        tmp_output,
        image_target,
        ffmpeg_args,
        format_label,
        target_label,
        lossless,
        set_preview,
    } = spec;
    let AvifEncodeContext {
        inner,
        config,
        settings,
        original_size_bytes,
        preserve_times_policy,
        input_times,
    } = *ctx;

    let (ffmpeg_path, _source, did_download_ffmpeg) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

    if did_download_ffmpeg {
        append_job_log_line(
            job,
            format!(
                "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
            ),
        );
        record_tool_download(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

    if job.start_time.is_none() {
        job.start_time = Some(current_time_millis());
    }

    let ffmpeg_cmd = format_command_for_log(&ffmpeg_path, &ffmpeg_args);
    job.ffmpeg_command = Some(ffmpeg_cmd.clone());
    let start_ms = current_time_millis();
    job.runs.push(JobRun {
        command: ffmpeg_cmd.clone(),
        logs: Vec::new(),
        started_at_ms: Some(start_ms),
    });
    append_job_log_line(job, format!("command: {ffmpeg_cmd}"));

    let output = run_killable_command_capture(
        inner,
        &job.id,
        &ffmpeg_path,
        &ffmpeg_args,
        format!(
            "failed to run ffmpeg for {format_label} on {}",
            path.display()
        ),
    )?;

    if let Some(stop_reason) = output.stop_reason {
        match stop_reason {
            MediaCommandStopReason::CancelRequested => {
                mark_job_cancelled_from_media_worker(job, tmp_output);
            }
            MediaCommandStopReason::WaitRequested => {
                mark_job_paused_from_media_worker(job, tmp_output);
            }
        }
        return Ok(());
    }

    if !output.status.success() {
        job.status = JobStatus::Failed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        append_job_log_line(job, String::from_utf8_lossy(&output.stderr).to_string());
        drop(fs::remove_file(tmp_output));
        return Ok(());
    }

    finalize_image_encode(FinalizeAvifEncodeSpec {
        inner,
        path,
        job,
        tmp_output,
        image_target,
        original_size_bytes,
        config,
        preserve_times_policy,
        input_times,
        tool_label: "ffmpeg",
        target_label,
        lossless,
        set_preview,
    })
}
