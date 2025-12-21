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
use super::super::output_policy_paths::plan_output_path_with_extension;
use super::super::state::{
    Inner,
    register_known_batch_compress_output_with_inner,
};
use super::super::worker_utils::append_job_log_line;
use super::helpers::{
    current_time_millis,
    next_job_id,
    record_tool_download,
};
use super::video_paths::ensure_progress_args;
use crate::ffui_core::domain::{
    AudioCodecType,
    BatchCompressConfig,
    FFmpegPreset,
    JobRun,
    JobSource,
    JobStatus,
    JobType,
    MediaInfo,
    TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

/// 根据输入扩展名与目标音频编码，选择与容器兼容的输出扩展名。
///
/// - AAC 输出默认使用 m4a（mp4 容器），除非输入已是 m4a/m4b/aac/mp4。
/// - Copy 输出延用原始扩展；若缺失则回退 m4a。
fn choose_audio_output_extension(input_ext: Option<&str>, codec: &AudioCodecType) -> String {
    let ext = input_ext.map(|s| s.to_ascii_lowercase());

    match codec {
        AudioCodecType::Aac => match ext.as_deref() {
            Some("m4a" | "m4b" | "aac" | "mp4") => ext.unwrap_or_else(|| "m4a".to_string()),
            _ => "m4a".to_string(),
        },
        AudioCodecType::Copy => ext.unwrap_or_else(|| "m4a".to_string()),
    }
}

pub(crate) fn handle_audio_file_with_id(
    inner: &Inner,
    path: &Path,
    config: &BatchCompressConfig,
    settings: &AppSettings,
    presets: &[FFmpegPreset],
    batch_id: &str,
    job_id: Option<String>,
) -> Result<TranscodeJob> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to stat audio file {}", path.display()))?;
    let original_size_bytes = metadata.len();
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

    // 根据 Batch Compress 配置选择音频预设：优先 audioPresetId，其次回退为空字符串。
    let audio_preset_id = config.audio_preset_id.clone().unwrap_or_default();

    let preset = presets.iter().find(|p| p.id == audio_preset_id).cloned();

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

    let mut job = TranscodeJob {
        id: job_id.unwrap_or_else(|| next_job_id(inner)),
        filename,
        job_type: JobType::Audio,
        source: JobSource::BatchCompress,
        queue_order: None,
        original_size_mb,
        original_codec: ext.clone(),
        // 对于找不到匹配预设的情况，仍然记录 audio_preset_id（可能为空字符串），
        // 以便前端在详情中展示“默认音频压缩”等信息。
        preset_id: audio_preset_id,
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

    // 按最小体积阈值预过滤明显不值得压缩的文件。
    if original_size_bytes < config.min_audio_size_kb.saturating_mul(1024) {
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.skip_reason = Some(format!("Size < {}KB", config.min_audio_size_kb));
        return Ok(job);
    }

    let (ffmpeg_path, _source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

    // 构建 ffmpeg 参数：音频-only，禁用视频流，使用 Batch Compress 默认或预设音频配置。
    let mut args: Vec<String> = Vec::new();
    ensure_progress_args(&mut args);
    if !args.iter().any(|a| a == "-nostdin") {
        args.push("-nostdin".to_string());
    }

    // 全局参数：尽量复用预设中的 overwrite/logLevel/hideBanner/report。
    if let Some(global) = preset.as_ref().and_then(|p| p.global.as_ref()) {
        use crate::ffui_core::domain::OverwriteBehavior;
        if let Some(behavior) = &global.overwrite_behavior {
            match behavior {
                OverwriteBehavior::Overwrite => {
                    args.push("-y".to_string());
                }
                OverwriteBehavior::NoOverwrite => {
                    args.push("-n".to_string());
                }
                OverwriteBehavior::Ask => {
                    // 使用 ffmpeg 默认行为，不追加标志。
                }
            }
        }
        if let Some(level) = &global.log_level
            && !level.is_empty()
        {
            args.push("-loglevel".to_string());
            args.push(level.clone());
        }
        if global.hide_banner.unwrap_or(false) {
            args.push("-hide_banner".to_string());
        }
        if global.enable_report.unwrap_or(false) {
            args.push("-report".to_string());
        }
    }

    // 输入
    args.push("-i".to_string());
    args.push(path.to_string_lossy().into_owned());

    // 显式禁用视频流，确保纯音频输出。
    args.push("-vn".to_string());
    // 映射第一路音频流（存在即可，?: 容忍无音频流的边界情况）。
    args.push("-map".to_string());
    args.push("0:a:0?".to_string());

    // 音频编码参数：优先使用预设中的 audio 配置，否则退回到默认 AAC 128k/48kHz/stereo。
    type AudioChainConfig = (
        AudioCodecType,
        Option<i32>,
        Option<u32>,
        Option<u32>,
        Option<String>,
        Option<String>,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<String>,
    );

    let (
        codec_type,
        bitrate,
        sample_rate_hz,
        channels,
        channel_layout,
        loudness_profile,
        target_lufs,
        loudness_range,
        true_peak_db,
        af_chain,
    ): AudioChainConfig = if let Some(ref preset) = preset {
        let ac = &preset.audio;
        (
            ac.codec.clone(),
            ac.bitrate,
            ac.sample_rate_hz,
            ac.channels,
            ac.channel_layout.clone(),
            ac.loudness_profile.clone(),
            ac.target_lufs,
            ac.loudness_range,
            ac.true_peak_db,
            preset
                .filters
                .af_chain
                .as_ref()
                .map(|s| s.trim().to_string()),
        )
    } else {
        (
            AudioCodecType::Aac,
            Some(128),
            Some(48_000),
            Some(2),
            Some("stereo".to_string()),
            Some("none".to_string()),
            None,
            None,
            None,
            None,
        )
    };

    let target_ext = choose_audio_output_extension(ext.as_deref(), &codec_type);

    let output_path = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let out = plan_output_path_with_extension(
            path,
            &target_ext,
            preset.as_ref(),
            &config.output_policy,
            |candidate| {
                let s = candidate.to_string_lossy();
                candidate.exists() || state.known_batch_compress_outputs.contains(s.as_ref())
            },
        );
        state
            .known_batch_compress_outputs
            .insert(out.to_string_lossy().into_owned());
        out
    };
    let tmp_output = {
        let stem = output_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        let ext = output_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("m4a");
        output_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("{stem}.tmp.{ext}"))
    };
    job.output_path = Some(output_path.to_string_lossy().into_owned());

    match codec_type {
        AudioCodecType::Copy => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        AudioCodecType::Aac => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            if let Some(bitrate) = bitrate {
                args.push("-b:a".to_string());
                args.push(format!("{bitrate}k"));
            }
            if let Some(sample_rate) = sample_rate_hz {
                args.push("-ar".to_string());
                args.push(sample_rate.to_string());
            }
            if let Some(ch) = channels {
                args.push("-ac".to_string());
                args.push(ch.to_string());
            }
            if let Some(layout) = channel_layout
                && !layout.is_empty()
            {
                args.push("-channel_layout".to_string());
                args.push(layout);
            }
        }
    }

    // 音频滤镜（loudnorm + af_chain）。
    let mut af_parts: Vec<String> = Vec::new();
    let profile = loudness_profile.unwrap_or_else(|| "none".to_string());
    if profile != "none" {
        let default_i = target_lufs.unwrap_or(if profile == "cnBroadcast" {
            -24.0
        } else {
            -23.0
        });
        let default_lra = loudness_range.unwrap_or(7.0);
        let default_tp = true_peak_db.unwrap_or(if profile == "cnBroadcast" { -2.0 } else { -1.0 });

        let safe_i = default_i.clamp(-36.0, -10.0);
        let safe_lra = default_lra.clamp(1.0, 20.0);
        let safe_tp = default_tp.min(-0.1);

        let loudnorm_expr =
            format!("loudnorm=I={safe_i}:LRA={safe_lra}:TP={safe_tp}:print_format=summary");
        af_parts.push(loudnorm_expr);
    }

    if let Some(chain) = af_chain {
        let trimmed = chain.trim().to_string();
        if !trimmed.is_empty() {
            af_parts.push(trimmed);
        }
    }

    if !af_parts.is_empty() {
        args.push("-af".to_string());
        args.push(af_parts.join(","));
    }

    args.push(tmp_output.to_string_lossy().into_owned());

    let start_ms = current_time_millis();
    job.start_time = Some(start_ms);

    let ffmpeg_cmd = format_command_for_log(&ffmpeg_path, &args);
    job.ffmpeg_command = Some(ffmpeg_cmd.clone());
    job.runs.push(JobRun {
        command: ffmpeg_cmd.clone(),
        logs: Vec::new(),
        started_at_ms: Some(start_ms),
    });
    if did_download {
        append_job_log_line(
            &mut job,
            format!(
                "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
            ),
        );
        record_tool_download(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }
    append_job_log_line(&mut job, format!("command: {ffmpeg_cmd}"));

    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .args(&args)
        .output()
        .with_context(|| format!("failed to run ffmpeg on audio {}", path.display()))?;

    if !output.status.success() {
        job.status = JobStatus::Failed;
        job.progress = 100.0;
        job.end_time = Some(current_time_millis());
        append_job_log_line(
            &mut job,
            String::from_utf8_lossy(&output.stderr).to_string(),
        );
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

    fs::rename(&tmp_output, &output_path).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_output.display(),
            output_path.display()
        )
    })?;

    if preserve_times_policy.any()
        && let Some(times) = input_times.as_ref()
        && let Err(err) = super::super::file_times::apply_file_times(&output_path, times)
    {
        append_job_log_line(
            &mut job,
            format!(
                "preserve file times: failed to apply timestamps to {}: {err}",
                output_path.display()
            ),
        );
    }

    // 将最终输出注册为 Batch Compress 已知输出，避免后续批次重复压缩。
    register_known_batch_compress_output_with_inner(inner, &output_path);

    job.status = JobStatus::Completed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));

    // 如果用户勾选了“替换原文件”，尝试将源音频移入系统回收站（最佳努力）。
    if config.replace_original {
        match trash::delete(path) {
            Ok(()) => append_job_log_line(
                &mut job,
                format!(
                    "replace original: moved source audio {} to recycle bin",
                    path.display()
                ),
            ),
            Err(err) => append_job_log_line(
                &mut job,
                format!(
                    "replace original: failed to move source audio {} to recycle bin: {err}",
                    path.display()
                ),
            ),
        }
    }

    Ok(job)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_audio_output_extension_prefers_m4a_for_aac_on_mp3_input() {
        let ext = choose_audio_output_extension(Some("mp3"), &AudioCodecType::Aac);
        assert_eq!(ext, "m4a");
    }

    #[test]
    fn choose_audio_output_extension_keeps_m4a_when_already_compatible() {
        let ext = choose_audio_output_extension(Some("m4a"), &AudioCodecType::Aac);
        assert_eq!(ext, "m4a");
    }

    #[test]
    fn choose_audio_output_extension_preserves_original_for_copy() {
        let ext = choose_audio_output_extension(Some("flac"), &AudioCodecType::Copy);
        assert_eq!(ext, "flac");
    }

    #[test]
    fn choose_audio_output_extension_falls_back_to_m4a_when_unknown() {
        let ext = choose_audio_output_extension(None, &AudioCodecType::Copy);
        assert_eq!(ext, "m4a");
    }
}
