use std::collections::VecDeque;
use std::fs;
use std::path::Path;

use anyhow::{
    Context,
    Result,
};

use super::super::ffmpeg_args::{
    build_ffmpeg_args as build_queue_ffmpeg_args,
    format_command_for_log,
};
use super::super::output_policy_paths::plan_video_output_path;
use super::super::state::Inner;
use super::super::worker_utils::append_job_log_line;
use super::helpers::{
    BatchCompressJobSpec,
    current_time_millis,
    make_batch_compress_job,
    next_job_id,
    record_tool_download,
    run_ffmpeg_and_finalize_tmp_output,
};
use super::video_helpers::{
    detect_video_codec,
    estimate_job_seconds_for_preset,
};
use super::video_paths::{
    build_ffmpeg_args,
    build_video_output_path,
    build_video_tmp_output_path,
};
use crate::ffui_core::domain::{
    BatchCompressConfig,
    FFmpegPreset,
    JobRun,
    JobStatus,
    JobType,
    OutputDirectoryPolicy,
    OutputFilenamePolicy,
    OutputPolicy,
    TranscodeJob,
};
use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};
use crate::sync_ext::MutexExt;

#[allow(dead_code)]
pub(crate) fn handle_video_file(
    inner: &Inner,
    path: &Path,
    config: &BatchCompressConfig,
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

    let output_plan =
        plan_video_output_path(path, preset.as_ref(), &config.output_policy, |candidate| {
            super::super::state::is_known_batch_compress_output_with_inner(inner, candidate)
        });
    let output_path = output_plan.output_path.to_string_lossy().into_owned();
    let warnings = output_plan.warnings;
    let mut logs: Vec<String> = Vec::new();
    for w in &warnings {
        logs.push(format!("warning: {}", w.message));
    }
    let runs = if logs.is_empty() {
        Vec::new()
    } else {
        vec![JobRun {
            command: String::new(),
            logs: logs.clone(),
            started_at_ms: None,
        }]
    };

    let mut job = make_batch_compress_job(BatchCompressJobSpec {
        job_id: next_job_id(inner),
        filename,
        job_type: JobType::Video,
        preset_id: config.video_preset_id.clone(),
        original_size_mb,
        original_codec: None,
        input_path: input_path.clone(),
        output_policy: config.output_policy.clone(),
        batch_id: batch_id.to_string(),
        start_time: None,
    });
    job.output_path = Some(output_path);
    job.logs = logs;
    job.runs = runs;
    job.warnings = warnings;

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

    // Batch Compress 任务不支持暂停 / 继续，这里复用 batch_compress::video_paths 中的
    // build_ffmpeg_args，它会自动注入 `-nostdin`，保证 ffmpeg 不会在交互提问上挂起。
    let args = build_ffmpeg_args(&preset, path, &tmp_output);

    if did_download {
        append_job_log_line(
            &mut job,
            format!(
                "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
            ),
        );
        record_tool_download(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

    let start_ms = current_time_millis();
    job.start_time = Some(start_ms);

    let run_context = format!("failed to run ffmpeg on {}", path.display());
    let Some(new_size_bytes) =
        run_ffmpeg_and_finalize_tmp_output(super::helpers::FinalizeTmpOutputSpec {
            ffmpeg_path: &ffmpeg_path,
            args: &args,
            tmp_output: &tmp_output,
            output_path: &output_path,
            original_size_bytes,
            config,
            job: &mut job,
            run_context,
        })?
    else {
        return Ok(job);
    };

    job.status = JobStatus::Completed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.output_size_mb = Some(new_size_bytes as f64 / (1024.0 * 1024.0));

    Ok(job)
}

pub(crate) fn enqueue_batch_compress_video_job(
    inner: &Inner,
    path: &Path,
    config: &BatchCompressConfig,
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

    // When Batch Compress is configured to replace the original video file, the output must be staged
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

    let mut job = make_batch_compress_job(super::helpers::BatchCompressJobSpec {
        job_id: id.clone(),
        filename,
        job_type: JobType::Video,
        preset_id: preset.id.clone(),
        original_size_mb,
        original_codec: None,
        input_path: input_path.clone(),
        output_policy: output_policy.clone(),
        batch_id: batch_id.to_string(),
        start_time: Some(now_ms),
    });

    // 根据体积与编解码预先过滤掉明显不值得压缩的文件。
    if original_size_mb < config.min_video_size_mb as f64 {
        job.status = JobStatus::Skipped;
        job.progress = 100.0;
        job.end_time = Some(now_ms);
        job.skip_reason = Some(format!("Size < {}MB", config.min_video_size_mb));

        let mut state = inner.state.lock_unpoisoned();
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

            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(id, job.clone());
            drop(state);

            if notify_queue {
                super::helpers::notify_queue_listeners(inner);
            }
            return job;
        }
    }

    // 为 Batch Compress 视频任务选择一个不会覆盖现有文件的输出路径，并记录到已知输出集合中。
    let mut state = inner.state.lock_unpoisoned();
    let output_plan = plan_video_output_path(path, Some(preset), &output_policy, |candidate| {
        let s = candidate.to_string_lossy();
        candidate.exists() || state.known_batch_compress_outputs.contains(s.as_ref())
    });
    let output_path = output_plan.output_path;
    if !output_plan.warnings.is_empty() {
        for w in &output_plan.warnings {
            append_job_log_line(&mut job, format!("warning: {}", w.message));
        }
        job.warnings = output_plan.warnings;
    }
    state
        .known_batch_compress_outputs
        .insert(output_path.to_string_lossy().into_owned());

    job.output_path = Some(output_path.to_string_lossy().into_owned());
    let planned_args =
        build_queue_ffmpeg_args(preset, path, &output_path, false, Some(&output_policy));
    job.ffmpeg_command = Some(format_command_for_log("ffmpeg", &planned_args));
    if let Some(run) = job.runs.first_mut()
        && run.command.is_empty()
        && job.ffmpeg_command.is_some()
    {
        run.command = job.ffmpeg_command.clone().unwrap_or_default();
    }
    job.estimated_seconds = estimate_job_seconds_for_preset(original_size_mb, preset);

    // Insert the job into the waiting queue while keeping Batch Compress batch
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
