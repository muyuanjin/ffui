use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use crate::ffui_core::domain::{
    FFmpegPreset, JobSource, JobStatus, JobType, MediaInfo, OutputDirectoryPolicy,
    OutputFilenamePolicy, OutputPolicy, SmartScanConfig, TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};

use super::super::ffmpeg_args::configure_background_command;
use super::super::ffmpeg_args::{
    build_ffmpeg_args as build_queue_ffmpeg_args, format_command_for_log,
};
use super::super::output_policy_paths::plan_video_output_path;
use super::super::state::Inner;
use super::helpers::{current_time_millis, next_job_id, record_tool_download};
use super::video_paths::{build_ffmpeg_args, build_video_output_path, build_video_tmp_output_path};

fn detect_video_codec(path: &Path, settings: &AppSettings) -> Result<String> {
    let (ffprobe_path, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, &settings.tools)?;
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

fn estimate_job_seconds_for_preset(size_mb: f64, preset: &FFmpegPreset) -> Option<f64> {
    if size_mb <= 0.0 {
        return None;
    }

    let stats = &preset.stats;
    if stats.total_input_size_mb <= 0.0 || stats.total_time_seconds <= 0.0 {
        return None;
    }

    // Baseline: average seconds-per-megabyte observed for this preset.
    let mut seconds_per_mb = stats.total_time_seconds / stats.total_input_size_mb;
    if !seconds_per_mb.is_finite() || seconds_per_mb <= 0.0 {
        return None;
    }

    // Adjust for encoder and preset "speed" where we have simple signals so
    // that obviously heavy configurations (e.g. libsvtav1, veryslow) are
    // weighted higher than fast ones.
    use crate::ffui_core::domain::EncoderType;

    let mut factor = 1.0f64;

    match preset.video.encoder {
        EncoderType::LibSvtAv1 => {
            // Modern AV1 encoders tend to be considerably slower.
            factor *= 1.5;
        }
        EncoderType::HevcNvenc => {
            // Hardware HEVC is usually fast; keep this close to 1.0 so size
            // remains the dominant factor.
            factor *= 0.9;
        }
        _ => {}
    }

    let preset_name = preset.video.preset.to_ascii_lowercase();
    if preset_name.contains("veryslow") {
        factor *= 1.6;
    } else if preset_name.contains("slow") {
        factor *= 1.3;
    } else if preset_name.contains("fast") {
        factor *= 0.8;
    }

    if let Some(pass) = preset.video.pass
        && pass >= 2
    {
        // Two-pass encoding roughly doubles total processing time.
        factor *= 2.0;
    }

    seconds_per_mb *= factor;
    let estimate = size_mb * seconds_per_mb;
    if !estimate.is_finite() || estimate <= 0.0 {
        None
    } else {
        Some(estimate)
    }
}

#[allow(dead_code)]
pub(crate) fn handle_video_file(
    inner: &Inner,
    path: &Path,
    config: &SmartScanConfig,
    settings: &AppSettings,
    preset: Option<FFmpegPreset>,
    batch_id: &str,
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
        id: next_job_id(inner),
        filename,
        job_type: JobType::Video,
        source: JobSource::SmartScan,
        queue_order: None,
        original_size_mb,
        original_codec: None,
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
        input_path: Some(input_path.clone()),
        output_path: Some(
            plan_video_output_path(path, preset.as_ref(), &config.output_policy, |candidate| {
                super::super::state::is_known_smart_scan_output_with_inner(inner, candidate)
            })
            .output_path
            .to_string_lossy()
            .into_owned(),
        ),
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

    // Pre-compute an approximate processing time for this job so the
    // taskbar can weight mixed workloads (e.g. small but very slow
    // presets) more accurately than a pure size-based heuristic.
    job.estimated_seconds = estimate_job_seconds_for_preset(original_size_mb, &preset);

    let (ffmpeg_path, _source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools)?;

    let container_format = preset.container.as_ref().and_then(|c| c.format.as_deref());

    let output_path = build_video_output_path(path, container_format);
    let tmp_output = build_video_tmp_output_path(path, container_format);

    // Smart Scan 任务不支持暂停 / 继续，这里复用 smart_scan::video_paths 中的
    // build_ffmpeg_args，它会自动注入 `-nostdin`，保证 ffmpeg 不会在交互提问上挂起。
    let args = build_ffmpeg_args(&preset, path, &tmp_output);

    if did_download {
        job.logs.push(format!(
            "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
        ));
        record_tool_download(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

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

pub(crate) fn enqueue_smart_scan_video_job(
    inner: &Inner,
    path: &Path,
    config: &SmartScanConfig,
    settings: &AppSettings,
    preset: &FFmpegPreset,
    batch_id: &str,
    notify_queue: bool,
) -> TranscodeJob {
    let original_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let original_size_mb = original_size_bytes as f64 / (1024.0 * 1024.0);

    let filename = path.to_string_lossy().into_owned();
    let input_path = filename.clone();

    let id = next_job_id(inner);
    let now_ms = current_time_millis();

    // When Smart Scan is configured to replace the original video file, the output must be staged
    // next to the input so the final rename stays within the same directory. In this mode we
    // intentionally ignore directory/filename rules and keep the traditional `.compressed` naming.
    let output_policy: OutputPolicy = if config.replace_original {
        OutputPolicy {
            container: config.output_policy.container.clone(),
            directory: OutputDirectoryPolicy::SameAsInput,
            filename: OutputFilenamePolicy::default(),
            preserve_file_times: config.output_policy.preserve_file_times.clone(),
        }
    } else {
        config.output_policy.clone()
    };

    let mut job = TranscodeJob {
        id: id.clone(),
        filename,
        job_type: JobType::Video,
        source: JobSource::SmartScan,
        queue_order: None,
        original_size_mb,
        original_codec: None,
        preset_id: preset.id.clone(),
        status: JobStatus::Waiting,
        progress: 0.0,
        start_time: Some(now_ms),
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(input_path.clone()),
        output_path: None,
        output_policy: Some(output_policy.clone()),
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

    // 根据体积与编解码预先过滤掉明显不值得压缩的文件。
    if original_size_mb < config.min_video_size_mb as f64 {
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.end_time = Some(now_ms);
        job.skip_reason = Some(format!("Size < {}MB", config.min_video_size_mb));

        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(id, job.clone());
        drop(state);

        if notify_queue {
            super::helpers::notify_queue_listeners(inner);
        }
        return job;
    }

    if let Ok(codec) = detect_video_codec(path, settings) {
        job.original_codec = Some(codec.clone());
        if let Some(info) = job.media_info.as_mut() {
            info.video_codec = Some(codec.clone());
        }
        let lower = codec.to_ascii_lowercase();
        if matches!(lower.as_str(), "hevc" | "hevc_nvenc" | "h265" | "av1") {
            job.status = JobStatus::Skipped;
            job.progress = 100.0;
            job.end_time = Some(now_ms);
            job.skip_reason = Some(format!("Codec is already {codec}"));

            let mut state = inner.state.lock().expect("engine state poisoned");
            state.jobs.insert(id, job.clone());
            drop(state);

            if notify_queue {
                super::helpers::notify_queue_listeners(inner);
            }
            return job;
        }
    }

    // 为 Smart Scan 视频任务选择一个不会覆盖现有文件的输出路径，并记录到已知输出集合中。
    let mut state = inner.state.lock().expect("engine state poisoned");
    let output_plan = plan_video_output_path(path, Some(preset), &output_policy, |candidate| {
        let s = candidate.to_string_lossy();
        candidate.exists() || state.known_smart_scan_outputs.contains(s.as_ref())
    });
    let output_path = output_plan.output_path;
    state
        .known_smart_scan_outputs
        .insert(output_path.to_string_lossy().into_owned());

    job.output_path = Some(output_path.to_string_lossy().into_owned());
    let planned_args =
        build_queue_ffmpeg_args(preset, path, &output_path, false, Some(&output_policy));
    job.ffmpeg_command = Some(format_command_for_log("ffmpeg", &planned_args));
    job.estimated_seconds = estimate_job_seconds_for_preset(original_size_mb, preset);

    // Insert the job into the waiting queue while keeping Smart Scan batch
    // children consecutive. If this batch already has waiting jobs, place
    // the new child right after the last existing sibling; otherwise append
    // to the tail like a normal enqueue.
    state.jobs.insert(id.clone(), job.clone());

    let mut queue_vec: Vec<String> = state.queue.iter().cloned().collect();
    let mut last_sibling_index: Option<usize> = None;
    for (index, existing_id) in queue_vec.iter().enumerate() {
        if let Some(existing) = state.jobs.get(existing_id)
            && existing.batch_id.as_deref() == Some(batch_id)
        {
            last_sibling_index = Some(index);
        }
    }

    match last_sibling_index {
        Some(idx) if idx < queue_vec.len() => queue_vec.insert(idx + 1, id.clone()),
        _ => queue_vec.push(id.clone()),
    }

    state.queue = VecDeque::from(queue_vec);
    drop(state);

    if notify_queue {
        inner.cv.notify_one();
        super::helpers::notify_queue_listeners(inner);
    }

    job
}
