use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{
    Context,
    Result,
};

use super::super::ffmpeg_args::{
    configure_background_command,
    format_command_for_log,
};
use super::super::state::{
    Inner,
    register_known_batch_compress_output_with_inner,
};
use super::super::worker_utils::append_job_log_line;
use super::helpers::{
    current_time_millis,
    record_tool_download,
};
use crate::ffui_core::domain::{
    BatchCompressConfig,
    JobStatus,
    PreserveFileTimesPolicy,
    TranscodeJob,
};
use crate::ffui_core::engine::file_times::FileTimesSnapshot;
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

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
    ctx: AvifEncodeContext<'_>,
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
    } = ctx;

    // Prefer avifenc; if unavailable or encode fails, fall back to ffmpeg.
    let (tried_avifenc, last_error): (bool, Option<anyhow::Error>) = match ensure_tool_available(
        ExternalToolKind::Avifenc,
        &settings.tools,
    ) {
        Ok((avifenc_path, _source, did_download)) => {
            let avifenc_path: String = avifenc_path;
            if did_download {
                append_job_log_line(
                    job,
                    format!(
                        "auto-download: avifenc was downloaded automatically according to current settings (path: {avifenc_path})"
                    ),
                );
                record_tool_download(inner, ExternalToolKind::Avifenc, &avifenc_path);
            }

            let start_ms = current_time_millis();
            job.start_time = Some(start_ms);

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
            if let Some(run) = job.runs.first_mut()
                && run.command.is_empty()
            {
                run.command = avif_cmd.clone();
            }
            append_job_log_line(job, format!("command: {avif_cmd}"));

            let mut cmd = Command::new(&avifenc_path);
            configure_background_command(&mut cmd);
            let output = cmd
                .args(&avif_args)
                .output()
                .with_context(|| format!("failed to run avifenc on {}", path.display()));

            let last_error = match output {
                Ok(output) if output.status.success() => {
                    let tmp_meta = fs::metadata(tmp_output).with_context(|| {
                        format!("failed to stat temp output {}", tmp_output.display())
                    })?;
                    let new_size_bytes = tmp_meta.len();
                    let ratio = new_size_bytes as f64 / original_size_bytes as f64;

                    if ratio > config.min_saving_ratio {
                        let _ = fs::remove_file(tmp_output);
                        job.status = JobStatus::Skipped;
                        job.progress = 100.0;
                        job.end_time = Some(current_time_millis());
                        job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
                        return Ok(());
                    }

                    fs::rename(tmp_output, avif_target).with_context(|| {
                        format!(
                            "failed to rename {} -> {}",
                            tmp_output.display(),
                            avif_target.display()
                        )
                    })?;

                    if preserve_times_policy.any()
                        && let Some(times) = input_times
                        && let Err(err) =
                            super::super::file_times::apply_file_times(avif_target, times)
                    {
                        append_job_log_line(
                            job,
                            format!(
                                "preserve file times: failed to apply timestamps to {}: {err}",
                                avif_target.display()
                            ),
                        );
                    }

                    register_known_batch_compress_output_with_inner(inner, avif_target);

                    job.status = JobStatus::Completed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
                    job.output_path = Some(avif_target.to_string_lossy().into_owned());
                    job.preview_path = Some(avif_target.to_string_lossy().into_owned());
                    job.preview_revision = job.preview_revision.saturating_add(1);

                    let output_mb = job.output_size_mb.unwrap_or(0.0);
                    append_job_log_line(
                        job,
                        format!(
                            "avifenc: lossless AVIF encode completed; new size {:.2} MB ({:.1}% of original)",
                            output_mb,
                            ratio * 100.0,
                        ),
                    );

                    if config.replace_original {
                        match trash::delete(path) {
                            Ok(()) => append_job_log_line(
                                job,
                                format!(
                                    "replace original: moved source image {} to recycle bin",
                                    path.display()
                                ),
                            ),
                            Err(err) => append_job_log_line(
                                job,
                                format!(
                                    "replace original: failed to move source image {} to recycle bin: {err}",
                                    path.display()
                                ),
                            ),
                        }
                    }

                    return Ok(());
                }
                Ok(output) => {
                    append_job_log_line(job, String::from_utf8_lossy(&output.stderr).to_string());
                    let _ = fs::remove_file(tmp_output);
                    Some(anyhow::anyhow!(
                        "avifenc exited with non-zero status: {}",
                        output.status
                    ))
                }
                Err(err) => {
                    let _ = fs::remove_file(tmp_output);
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

    let ffmpeg_cmd = format_command_for_log(&ffmpeg_path, &ffmpeg_args);
    job.ffmpeg_command = Some(ffmpeg_cmd.clone());
    if let Some(run) = job.runs.first_mut()
        && run.command.is_empty()
    {
        run.command = ffmpeg_cmd.clone();
    }
    append_job_log_line(job, format!("command: {ffmpeg_cmd}"));

    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .args(&ffmpeg_args)
        .output()
        .with_context(|| format!("failed to run ffmpeg for AVIF on {}", path.display()))?;

    if !output.status.success() {
        job.status = JobStatus::Failed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        append_job_log_line(job, String::from_utf8_lossy(&output.stderr).to_string());
        let _ = fs::remove_file(tmp_output);
        return Ok(());
    }

    let tmp_meta = fs::metadata(tmp_output)
        .with_context(|| format!("failed to stat temp output {}", tmp_output.display()))?;
    let new_size_bytes = tmp_meta.len();
    let ratio = new_size_bytes as f64 / original_size_bytes as f64;

    if ratio > config.min_saving_ratio {
        let _ = fs::remove_file(tmp_output);
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
        return Ok(());
    }

    fs::rename(tmp_output, avif_target).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_output.display(),
            avif_target.display()
        )
    })?;

    if preserve_times_policy.any()
        && let Some(times) = input_times
        && let Err(err) = super::super::file_times::apply_file_times(avif_target, times)
    {
        append_job_log_line(
            job,
            format!(
                "preserve file times: failed to apply timestamps to {}: {err}",
                avif_target.display()
            ),
        );
    }

    register_known_batch_compress_output_with_inner(inner, avif_target);

    job.status = JobStatus::Completed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
    job.output_path = Some(avif_target.to_string_lossy().into_owned());

    let output_mb = job.output_size_mb.unwrap_or(0.0);
    append_job_log_line(
        job,
        format!(
            "ffmpeg: AVIF encode completed; new size {:.2} MB ({:.1}% of original)",
            output_mb,
            ratio * 100.0,
        ),
    );

    if config.replace_original {
        match trash::delete(path) {
            Ok(()) => append_job_log_line(
                job,
                format!(
                    "replace original: moved source image {} to recycle bin",
                    path.display()
                ),
            ),
            Err(err) => append_job_log_line(
                job,
                format!(
                    "replace original: failed to move source image {} to recycle bin: {err}",
                    path.display()
                ),
            ),
        }
    }

    Ok(())
}
