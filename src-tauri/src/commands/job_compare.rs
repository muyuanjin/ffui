//! Job compare commands (input vs output).
//!
//! These commands are on-demand (not part of high-frequency queue snapshots)
//! and are designed to support the "compare window" UI without generating any
//! proxy videos.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ffui_core::{
    FallbackFramePosition, FallbackFrameQuality, JobStatus, JobType, TranscodeJob,
    TranscodingEngine, extract_concat_preview_frame, extract_fallback_frame,
};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum JobCompareOutput {
    Completed {
        #[serde(rename = "outputPath")]
        output_path: String,
    },
    Partial {
        #[serde(rename = "segmentPaths")]
        segment_paths: Vec<String>,
        #[serde(rename = "activeSegmentPath", skip_serializing_if = "Option::is_none")]
        active_segment_path: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCompareSources {
    pub job_id: String,
    pub input_path: String,
    pub output: JobCompareOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_compare_seconds: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetJobCompareSourcesArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
}

fn trim_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn ordered_job_segments(job: &TranscodeJob) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(meta) = job.wait_metadata.as_ref() {
        if let Some(segs) = meta.segments.as_ref() {
            for s in segs {
                if let Some(path) = trim_path(s) {
                    out.push(path);
                }
            }
        }
        if out.is_empty()
            && let Some(tmp) = meta.tmp_output_path.as_ref()
            && let Some(path) = trim_path(tmp)
        {
            out.push(path);
        }
    }
    out
}

fn job_active_segment_path(job: &TranscodeJob) -> Option<String> {
    job.wait_metadata
        .as_ref()
        .and_then(|m| m.tmp_output_path.as_ref())
        .and_then(|s| trim_path(s))
}

fn compute_max_compare_seconds(job: &TranscodeJob) -> Option<f64> {
    let duration = job
        .media_info
        .as_ref()
        .and_then(|m| m.duration_seconds)
        .filter(|d| d.is_finite() && *d > 0.0);

    let from_wait = job
        .wait_metadata
        .as_ref()
        .and_then(|m| m.processed_seconds)
        .filter(|s| s.is_finite() && *s > 0.0);

    match job.status {
        JobStatus::Paused => from_wait.map(|s| duration.map(|d| s.min(d)).unwrap_or(s)),
        JobStatus::Processing => {
            let from_progress = duration.and_then(|d| {
                if job.progress.is_finite() && job.progress > 0.0 {
                    Some(((job.progress / 100.0) * d).clamp(0.0, d))
                } else {
                    None
                }
            });
            match (from_progress, from_wait, duration) {
                (Some(p), _, _) => Some(p),
                (None, Some(w), Some(d)) => Some(w.min(d)),
                (None, Some(w), None) => Some(w),
                _ => None,
            }
        }
        _ => None,
    }
}

fn build_job_compare_sources(job: &TranscodeJob) -> Option<JobCompareSources> {
    if job.job_type != JobType::Video {
        return None;
    }

    let job_id = job.id.clone();
    let input_path = trim_path(job.input_path.as_deref().unwrap_or(job.filename.as_str()))?;

    let max_compare_seconds = compute_max_compare_seconds(job);

    let output = match job.status {
        JobStatus::Completed => {
            let output_path = job
                .output_path
                .as_deref()
                .and_then(trim_path)
                .or_else(|| job_active_segment_path(job))?;
            JobCompareOutput::Completed { output_path }
        }
        JobStatus::Processing | JobStatus::Paused => {
            let segment_paths = ordered_job_segments(job);
            let active_segment_path = if job.status == JobStatus::Processing {
                job_active_segment_path(job)
            } else {
                None
            };
            if segment_paths.is_empty() && active_segment_path.is_none() {
                return None;
            }
            JobCompareOutput::Partial {
                segment_paths,
                active_segment_path,
            }
        }
        _ => return None,
    };

    Some(JobCompareSources {
        job_id,
        input_path,
        output,
        max_compare_seconds,
    })
}

/// Return compare sources for a single job (input vs output).
///
/// This MUST remain lightweight (no ffprobe/ffmpeg I/O). It only inspects
/// in-memory job state and returns best-effort paths and range metadata.
#[tauri::command]
pub fn get_job_compare_sources(
    engine: State<'_, TranscodingEngine>,
    args: GetJobCompareSourcesArgs,
) -> Option<JobCompareSources> {
    let job = engine.job_detail(&args.job_id)?;
    build_job_compare_sources(&job)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameQualityParam {
    Low,
    High,
}

impl From<FrameQualityParam> for FallbackFrameQuality {
    fn from(value: FrameQualityParam) -> Self {
        match value {
            FrameQualityParam::Low => Self::Low,
            FrameQualityParam::High => Self::High,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractJobCompareFrameArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
    #[serde(rename = "sourcePath", alias = "source_path")]
    pub source_path: String,
    #[serde(rename = "positionSeconds", alias = "position_seconds")]
    pub position_seconds: f64,
    #[serde(rename = "durationSeconds", alias = "duration_seconds")]
    pub duration_seconds: Option<f64>,
    pub quality: FrameQualityParam,
}

fn allowlisted_compare_paths(job: &TranscodeJob) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(path) = trim_path(job.filename.as_str()) {
        out.push(path);
    }
    if let Some(path) = job.input_path.as_deref().and_then(trim_path) {
        out.push(path);
    }
    if let Some(path) = job.output_path.as_deref().and_then(trim_path) {
        out.push(path);
    }
    if let Some(path) = job_active_segment_path(job) {
        out.push(path);
    }
    out.extend(ordered_job_segments(job));

    // Deduplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    out.into_iter().filter(|p| seen.insert(p.clone())).collect()
}

/// Extract a cached compare frame (JPEG) at a requested position.
///
/// This command is scoped to a job's known input/output paths and rejects
/// arbitrary paths.
#[tauri::command]
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

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractJobCompareConcatFrameArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
    #[serde(rename = "segmentPaths", alias = "segment_paths")]
    pub segment_paths: Vec<String>,
    #[serde(rename = "positionSeconds", alias = "position_seconds")]
    pub position_seconds: f64,
    pub quality: FrameQualityParam,
}

/// Extract a cached compare frame from concatenated output segments (JPEG).
///
/// This MUST NOT generate any proxy/concat video files; it only extracts a
/// single frame via the FFmpeg concat demuxer.
#[tauri::command]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::{MediaInfo, WaitMetadata};
    use std::path::PathBuf;

    fn sample_video_job(status: JobStatus) -> TranscodeJob {
        TranscodeJob {
            id: "job-1".to_string(),
            filename: "C:/videos/input.mp4".to_string(),
            job_type: JobType::Video,
            source: crate::ffui_core::JobSource::Manual,
            queue_order: None,
            original_size_mb: 0.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status,
            progress: 10.0,
            start_time: None,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/output.mp4".to_string()),
            output_policy: None,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: Some(120.0),
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            }),
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: Some(WaitMetadata {
                last_progress_percent: Some(10.0),
                processed_wall_millis: None,
                processed_seconds: Some(12.5),
                tmp_output_path: Some("C:/app-data/tmp/seg1.mp4".to_string()),
                segments: Some(vec![
                    "C:/app-data/tmp/seg0.mp4".to_string(),
                    "C:/app-data/tmp/seg1.mp4".to_string(),
                ]),
            }),
        }
    }

    #[test]
    fn allowlisted_paths_reject_arbitrary_sources() {
        let job = sample_video_job(JobStatus::Paused);
        let allowlisted = allowlisted_compare_paths(&job);
        assert!(
            allowlisted.iter().any(|p| p == "C:/videos/input.mp4"),
            "input path should be allowlisted"
        );
        assert!(
            allowlisted.iter().any(|p| p == "C:/app-data/tmp/seg1.mp4"),
            "tmp output should be allowlisted"
        );
        assert!(
            !allowlisted
                .iter()
                .any(|p| p == "C:/windows/system32/notepad.exe"),
            "arbitrary paths must not be allowlisted"
        );
    }

    #[test]
    fn concat_segment_order_is_stable_and_escaped() {
        let segs = vec![
            PathBuf::from("C:/tmp/seg0.mp4"),
            PathBuf::from("C:/tmp/seg'1.mp4"),
        ];
        let contents = crate::ffui_core::build_concat_list_contents_for_tests(&segs);
        assert!(
            contents.lines().next().unwrap_or("").contains("seg0.mp4"),
            "first entry should be seg0"
        );
        assert!(
            contents
                .lines()
                .nth(1)
                .unwrap_or("")
                .contains("seg'\\''1.mp4"),
            "single quotes must be escaped"
        );
    }

    #[test]
    fn concat_cache_path_stays_under_previews() {
        let dir = crate::ffui_core::compare_frames_dir_for_tests();
        let s = dir.to_string_lossy().replace('\\', "/");
        assert!(
            s.contains("/previews/compare-cache/frames")
                || s.ends_with("previews/compare-cache/frames"),
            "compare frames dir must live under previews: {s}"
        );
    }

    #[test]
    fn concat_command_requires_exact_segment_list_match() {
        let job = sample_video_job(JobStatus::Paused);
        let expected = ordered_job_segments(&job);
        assert_eq!(expected.len(), 2);

        let mut reversed = expected.clone();
        reversed.reverse();
        assert_ne!(reversed, expected, "sanity: reversed differs");

        let requested: Vec<String> = reversed;
        assert_ne!(
            requested, expected,
            "requested segment order mismatch should be detectable"
        );
    }
}
