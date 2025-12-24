//! Job compare commands (input vs output).
//!
//! These commands are on-demand (not part of high-frequency queue snapshots)
//! and are designed to support the "compare window" UI without generating any
//! proxy videos.

use serde::{
    Deserialize,
    Serialize,
};
use tauri::State;

use crate::ffui_core::{
    FallbackFramePosition,
    FallbackFrameQuality,
    JobStatus,
    JobType,
    TranscodeJob,
    TranscodingEngine,
    extract_concat_preview_frame,
    extract_fallback_frame,
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
    // Guard against "seek-to-live-edge" issues where the UI tries to seek to the exact end
    // of an in-flight segment and the webview/media pipeline responds with 416 (Range Not Satisfiable).
    const PAUSED_LIVE_EDGE_GUARD_SECONDS: f64 = 0.25;
    // While the job is actively processing, the temp output segment may be missing indices
    // (e.g. MP4 moov atom not finalized). A larger guard keeps compare scrubbing away from the
    // live edge so frame extraction remains reliable.
    const PROCESSING_LIVE_EDGE_GUARD_SECONDS: f64 = 1.25;

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

    let guard_live_edge =
        |seconds: f64, duration: Option<f64>, guard_seconds: f64| -> Option<f64> {
            if !seconds.is_finite() || seconds <= 0.0 {
                return None;
            }

            let mut out = seconds;
            if let Some(d) = duration {
                out = out.min(d);
            }

            // Keep at least a tiny positive range when possible, but avoid negative.
            if guard_seconds.is_finite() && guard_seconds > 0.0 && out > guard_seconds {
                out = (out - guard_seconds).max(0.0);
            }

            if out.is_finite() && out > 0.0 {
                Some(out)
            } else {
                None
            }
        };

    match job.status {
        JobStatus::Paused => {
            from_wait.and_then(|s| guard_live_edge(s, duration, PAUSED_LIVE_EDGE_GUARD_SECONDS))
        }
        JobStatus::Processing => {
            // Prefer the backend-reported processed seconds when available. Progress percent may
            // advance ahead of what is actually writable/seekable in the current output segment.
            if let Some(w) = from_wait {
                return guard_live_edge(w, duration, PROCESSING_LIVE_EDGE_GUARD_SECONDS);
            }

            let from_progress = duration.and_then(|d| {
                if job.progress.is_finite() && job.progress > 0.0 {
                    Some(((job.progress / 100.0) * d).clamp(0.0, d))
                } else {
                    None
                }
            });
            from_progress
                .and_then(|p| guard_live_edge(p, duration, PROCESSING_LIVE_EDGE_GUARD_SECONDS))
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
/// single frame via the `FFmpeg` concat demuxer.
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
#[path = "job_compare/tests.rs"]
mod tests;
