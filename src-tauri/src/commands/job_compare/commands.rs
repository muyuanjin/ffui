use tauri::State;

use crate::ffui_core::{
    FallbackFramePosition, JobStatus, JobType, TranscodingEngine, extract_concat_preview_frame,
    extract_fallback_frame,
};

use super::helpers::{
    allowlisted_compare_paths, build_job_compare_sources, build_output_segments_with_active,
    build_segment_end_targets_best_effort, compute_max_compare_seconds, job_active_segment_path,
    map_seconds_to_segment, ordered_job_segments, trim_path,
};
use super::types::{
    ExtractJobCompareConcatFrameArgs, ExtractJobCompareFrameArgs, ExtractJobCompareOutputFrameArgs,
    GetJobCompareSourcesArgs, JobCompareSources,
};

/// Return compare sources for a single job (input vs output).
///
/// This MUST remain lightweight (no ffprobe/ffmpeg I/O). It only inspects
/// in-memory job state and returns best-effort paths and range metadata.
pub fn get_job_compare_sources(
    engine: State<'_, TranscodingEngine>,
    args: GetJobCompareSourcesArgs,
) -> Option<JobCompareSources> {
    let job = engine.job_detail(&args.job_id)?;
    build_job_compare_sources(&job)
}

/// Extract a cached compare frame (JPEG) at a requested position.
///
/// This command is scoped to a job's known input/output paths and rejects
/// arbitrary paths.
pub fn extract_job_compare_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareFrameArgs,
) -> Result<String, String> {
    let settings = engine.settings();
    let job = engine
        .job_detail(&args.job_id)
        .ok_or_else(|| "job not found".to_string())?;
    if job.job_type != JobType::Video {
        return Err("job is not a video job".to_string());
    }

    let requested =
        trim_path(&args.source_path).ok_or_else(|| "sourcePath is empty".to_string())?;
    let allowlisted = allowlisted_compare_paths(&job);
    if !allowlisted.iter().any(|p| p == &requested) {
        return Err("sourcePath is not associated with the job".to_string());
    }

    let max_compare_seconds = compute_max_compare_seconds(&job);
    let clamped_seconds = match max_compare_seconds {
        Some(max) if max.is_finite() && max > 0.0 => args.position_seconds.clamp(0.0, max),
        _ => args.position_seconds.max(0.0),
    };

    let path = extract_fallback_frame(
        &requested,
        &settings.tools,
        args.duration_seconds,
        FallbackFramePosition::Seconds(clamped_seconds),
        args.quality.into(),
    )
    .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Extract a cached compare frame from concatenated output segments (JPEG).
///
/// This MUST NOT generate any proxy/concat video files; it only extracts a
/// single frame via the `FFmpeg` concat demuxer.
pub fn extract_job_compare_concat_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareConcatFrameArgs,
) -> Result<String, String> {
    let settings = engine.settings();
    let job = engine
        .job_detail(&args.job_id)
        .ok_or_else(|| "job not found".to_string())?;
    if job.job_type != JobType::Video {
        return Err("job is not a video job".to_string());
    }

    let expected = ordered_job_segments(&job);
    let requested: Vec<String> = args
        .segment_paths
        .iter()
        .filter_map(|s| trim_path(s))
        .collect();

    if expected.len() < 2 {
        return Err("job does not have multiple output segments".to_string());
    }
    if requested != expected {
        return Err("segmentPaths must match the job's recorded segment list".to_string());
    }

    let max_compare_seconds = compute_max_compare_seconds(&job);
    let clamped_seconds = match max_compare_seconds {
        Some(max) if max.is_finite() && max > 0.0 => args.position_seconds.clamp(0.0, max),
        _ => args.position_seconds.max(0.0),
    };

    let path = extract_concat_preview_frame(
        &requested,
        &settings.tools,
        clamped_seconds,
        args.quality.into(),
    )
    .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Extract a cached compare frame from the job's *output* timeline (JPEG).
///
/// Unlike `extract_job_compare_frame`, this command does not accept an arbitrary
/// source path. It derives the correct output segment (and local time offset)
/// from the job's persisted segment metadata so the compare timeline stays
/// aligned while transcoding is still in progress.
pub fn extract_job_compare_output_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareOutputFrameArgs,
) -> Result<String, String> {
    let settings = engine.settings();
    let job = engine
        .job_detail(&args.job_id)
        .ok_or_else(|| "job not found".to_string())?;
    if job.job_type != JobType::Video {
        return Err("job is not a video job".to_string());
    }

    let max_compare_seconds = compute_max_compare_seconds(&job);
    let clamped_seconds = match max_compare_seconds {
        Some(max) if max.is_finite() && max > 0.0 => args.position_seconds.clamp(0.0, max),
        _ => args.position_seconds.max(0.0),
    };

    let duration_hint = args
        .duration_seconds
        .or_else(|| job.media_info.as_ref().and_then(|m| m.duration_seconds))
        .filter(|d| d.is_finite() && *d > 0.0);

    let allowlisted = allowlisted_compare_paths(&job);

    let frame_path = match job.status {
        JobStatus::Completed => {
            let output_path = job
                .output_path
                .as_deref()
                .and_then(trim_path)
                .or_else(|| job_active_segment_path(&job))
                .ok_or_else(|| "missing output path".to_string())?;

            if !allowlisted.iter().any(|p| p == &output_path) {
                return Err("output path is not associated with the job".to_string());
            }

            extract_fallback_frame(
                &output_path,
                &settings.tools,
                duration_hint,
                FallbackFramePosition::Seconds(clamped_seconds),
                args.quality.into(),
            )
            .map_err(|e| e.to_string())?
        }
        JobStatus::Processing | JobStatus::Paused => {
            let segments = build_output_segments_with_active(&job);
            if segments.is_empty() {
                return Err("job does not have output segments".to_string());
            }

            if let Some(end_targets) = build_segment_end_targets_best_effort(
                &job,
                &settings.tools,
                &segments,
                clamped_seconds,
            ) {
                let hit = map_seconds_to_segment(&segments, &end_targets, clamped_seconds)
                    .ok_or_else(|| "unable to map seconds to an output segment".to_string())?;

                let seg_path = segments
                    .get(hit.index)
                    .cloned()
                    .ok_or_else(|| "output segment index out of range".to_string())?;

                if !allowlisted.iter().any(|p| p == &seg_path) {
                    return Err("output segment is not associated with the job".to_string());
                }

                extract_fallback_frame(
                    &seg_path,
                    &settings.tools,
                    hit.duration_seconds_hint,
                    FallbackFramePosition::Seconds(hit.local_seconds),
                    args.quality.into(),
                )
                .map_err(|e| e.to_string())?
            } else {
                // Last-resort fallback: concat the recorded segment list and extract by global time.
                // This can be slower but preserves correctness when segment metadata is missing.
                let concat_segments = ordered_job_segments(&job);
                if concat_segments.len() >= 2 {
                    extract_concat_preview_frame(
                        &concat_segments,
                        &settings.tools,
                        clamped_seconds,
                        args.quality.into(),
                    )
                    .map_err(|e| e.to_string())?
                } else {
                    let single = concat_segments
                        .first()
                        .cloned()
                        .or_else(|| job_active_segment_path(&job))
                        .ok_or_else(|| "missing output segment".to_string())?;

                    if !allowlisted.iter().any(|p| p == &single) {
                        return Err("output segment is not associated with the job".to_string());
                    }

                    extract_fallback_frame(
                        &single,
                        &settings.tools,
                        None,
                        FallbackFramePosition::Seconds(clamped_seconds),
                        args.quality.into(),
                    )
                    .map_err(|e| e.to_string())?
                }
            }
        }
        _ => return Err("job output is not available for compare".to_string()),
    };

    Ok(frame_path.to_string_lossy().into_owned())
}
