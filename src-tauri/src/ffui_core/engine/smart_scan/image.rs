use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};

use crate::ffui_core::domain::{
    JobSource, JobStatus, JobType, MediaInfo, SmartScanConfig, TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};

use super::super::ffmpeg_args::{configure_background_command, format_command_for_log};
use super::super::output_policy_paths::plan_output_path_with_extension;
use super::super::state::Inner;
use super::super::state::register_known_smart_scan_output_with_inner;
use super::super::worker_utils::recompute_log_tail;
use super::helpers::{current_time_millis, next_job_id, record_tool_download};

#[cfg(test)]
pub(crate) fn handle_image_file(
    inner: &Inner,
    path: &Path,
    config: &SmartScanConfig,
    settings: &AppSettings,
    batch_id: &str,
) -> Result<TranscodeJob> {
    handle_image_file_with_id(inner, path, config, settings, batch_id, None)
}

pub(crate) fn handle_image_file_with_id(
    inner: &Inner,
    path: &Path,
    config: &SmartScanConfig,
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
        batch_id: Some(batch_id.to_string()),
        wait_metadata: None,
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let preserve_file_times = config.output_policy.preserve_file_times;
    let input_times = if preserve_file_times {
        Some(super::super::file_times::read_file_times(path))
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
        register_known_smart_scan_output_with_inner(inner, &sibling_avif);
        job.output_path = Some(sibling_avif.to_string_lossy().into_owned());
        job.preview_path = Some(sibling_avif.to_string_lossy().into_owned());
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some("Existing .avif sibling".to_string());
        return Ok(job);
    }

    // Compute output path based on Smart Scan output policy (extension is driven by image target format).
    // Note: current Smart Scan image pipeline encodes AVIF; `imageTargetFormat` may be extended later.
    let (avif_target, tmp_output) = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let target = plan_output_path_with_extension(
            path,
            "avif",
            None,
            &config.output_policy,
            |candidate| {
                let s = candidate.to_string_lossy();
                candidate.exists() || state.known_smart_scan_outputs.contains(s.as_ref())
            },
        );
        state
            .known_smart_scan_outputs
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

            // 构建 avifenc 命令行：使用 10bit 4:4:4 + sRGB/BT.709 CICP 与 full range，
            // 尽量避免解码端按照错误的默认色彩参数导致的明显偏色。
            let avif_args: Vec<String> = vec![
                "--lossless".to_string(),
                "--depth".to_string(),
                "10".to_string(),
                "--yuv".to_string(),
                "444".to_string(),
                // 使用 CICP (nclx) 1/13/1 近似 sRGB / BT.709。
                "--cicp".to_string(),
                "1/13/1".to_string(),
                // 显式标记 full range，减少播放器误判为 limited 的机会。
                "--range".to_string(),
                "full".to_string(),
                path.to_string_lossy().into_owned(),
                tmp_output.to_string_lossy().into_owned(),
            ];

            // 将实际执行的命令记录到任务中，便于 UI 展示与复制。
            let avif_cmd = format_command_for_log(&avifenc_path, &avif_args);
            job.ffmpeg_command = Some(avif_cmd.clone());
            job.logs.push(format!("command: {avif_cmd}"));

            let mut cmd = Command::new(&avifenc_path);
            configure_background_command(&mut cmd);
            let output = cmd
                .args(&avif_args)
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

                    if preserve_file_times
                        && let Some(times) = input_times.as_ref()
                        && let Err(err) =
                            super::super::file_times::apply_file_times(&avif_target, times)
                    {
                        job.logs.push(format!(
                            "preserve file times: failed to apply timestamps to {}: {err}",
                            avif_target.display()
                        ));
                    }

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

                    job.logs.push(format!(
                        "avifenc: lossless AVIF encode completed; new size {:.2} MB ({:.1}% of original)",
                        job.output_size_mb.unwrap_or(0.0),
                        ratio * 100.0,
                    ));

                    // 若用户勾选“替换原文件”，尝试将源图片移入系统回收站（最佳努力）。
                    if config.replace_original {
                        match trash::delete(path) {
                            Ok(()) => job.logs.push(format!(
                                "replace original: moved source image {} to recycle bin",
                                path.display()
                            )),
                            Err(err) => job.logs.push(format!(
                                "replace original: failed to move source image {} to recycle bin: {err}",
                                path.display()
                            )),
                        }
                    }

                    recompute_log_tail(&mut job);
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

    // 使用 ffmpeg 兜底做 AVIF 编码时，同时显式设置色彩参数，降低偏色风险。
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
        // 显式声明色彩信息为 sRGB/BT.709 full range。
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
    job.logs.push(format!("command: {ffmpeg_cmd}"));

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

    if preserve_file_times
        && let Some(times) = input_times.as_ref()
        && let Err(err) = super::super::file_times::apply_file_times(&avif_target, times)
    {
        job.logs.push(format!(
            "preserve file times: failed to apply timestamps to {}: {err}",
            avif_target.display()
        ));
    }

    register_known_smart_scan_output_with_inner(inner, &avif_target);

    job.status = JobStatus::Completed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));
    // When falling back to ffmpeg-based AVIF encoding, also expose the
    // resulting AVIF as the job's output path so the UI can display it.
    job.output_path = Some(avif_target.to_string_lossy().into_owned());

    job.logs.push(format!(
        "ffmpeg: AVIF encode completed; new size {:.2} MB ({:.1}% of original)",
        job.output_size_mb.unwrap_or(0.0),
        ratio * 100.0,
    ));

    if config.replace_original {
        match trash::delete(path) {
            Ok(()) => job.logs.push(format!(
                "replace original: moved source image {} to recycle bin",
                path.display()
            )),
            Err(err) => job.logs.push(format!(
                "replace original: failed to move source image {} to recycle bin: {err}",
                path.display()
            )),
        }
    }

    recompute_log_tail(&mut job);

    Ok(job)
}
