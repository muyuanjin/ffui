use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};

use crate::ffui_core::domain::{
    JobSource, JobStatus, JobType, MediaInfo, SmartScanConfig, TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};

use super::super::ffmpeg_args::configure_background_command;
use super::super::state::Inner;
use super::super::state::register_known_smart_scan_output_with_inner;
use super::detection::build_image_avif_paths;
use super::helpers::{current_time_millis, next_job_id, record_tool_download};

pub(crate) fn handle_image_file(
    inner: &Inner,
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
        id: next_job_id(inner),
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
        register_known_smart_scan_output_with_inner(inner, &avif_target);

        // Prefer the existing AVIF sibling as the preview surface so the UI
        // can show the final compressed result instead of the original PNG.
        job.output_path = Some(avif_target.to_string_lossy().into_owned());
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
            let avifenc_path: String = avifenc_path;
            if did_download {
                job.logs.push(format!(
                        "auto-download: avifenc was downloaded automatically according to current settings (path: {avifenc_path})"
                    ));
                // Persist avifenc download metadata so future runs can reuse it.
                record_tool_download(inner, ExternalToolKind::Avifenc, &avifenc_path);
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

                    register_known_smart_scan_output_with_inner(inner, &avif_target);

                    job.status = JobStatus::Completed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
                    // For image Smart Scan jobs, surface the final AVIF path as both
                    // the logical output path and preview surface so the UI can show
                    // "compressed file path" alongside the original input.
                    job.output_path = Some(avif_target.to_string_lossy().into_owned());
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
        (Some(err), false) => {
            format!("avifenc is not available ({err:#}); falling back to ffmpeg-based AVIF encode")
        }
        (None, _) => "avifenc not used; falling back to ffmpeg-based AVIF encode".to_string(),
    });

    let (ffmpeg_path, _source, did_download_ffmpeg) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

    if did_download_ffmpeg {
        job.logs.push(format!(
            "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
        ));
        record_tool_download(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
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

    register_known_smart_scan_output_with_inner(inner, &avif_target);

    job.status = JobStatus::Completed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
    // When falling back to ffmpeg-based AVIF encoding, also expose the
    // resulting AVIF as the job's output path so the UI can display it.
    job.output_path = Some(avif_target.to_string_lossy().into_owned());

    Ok(job)
}
