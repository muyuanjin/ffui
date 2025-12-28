use crate::ffui_core::{
    ExternalToolSettings, JobStatus, JobType, TranscodeJob,
    probe_video_duration_seconds_best_effort,
};

use super::types::{JobCompareOutput, JobCompareSources};

pub(super) fn trim_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn ordered_job_segments(job: &TranscodeJob) -> Vec<String> {
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

pub(super) fn job_active_segment_path(job: &TranscodeJob) -> Option<String> {
    job.wait_metadata
        .as_ref()
        .and_then(|m| m.tmp_output_path.as_ref())
        .and_then(|s| trim_path(s))
}

pub(super) fn compute_max_compare_seconds(job: &TranscodeJob) -> Option<f64> {
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

pub(super) fn build_job_compare_sources(job: &TranscodeJob) -> Option<JobCompareSources> {
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

pub(super) fn allowlisted_compare_paths(job: &TranscodeJob) -> Vec<String> {
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SegmentHit {
    pub(super) index: usize,
    pub(super) local_seconds: f64,
    pub(super) duration_seconds_hint: Option<f64>,
}

pub(super) fn map_seconds_to_segment(
    segments: &[String],
    end_targets: &[f64],
    seconds: f64,
) -> Option<SegmentHit> {
    if segments.is_empty() || end_targets.is_empty() {
        return None;
    }
    if segments.len() != end_targets.len() {
        return None;
    }

    let s = seconds.max(0.0);
    let mut prev_end = 0.0_f64;
    for (idx, end) in end_targets.iter().copied().enumerate() {
        if !end.is_finite() || end <= prev_end {
            return None;
        }
        if s < end {
            let local = (s - prev_end).max(0.0);
            let dur = (end - prev_end).max(0.0);
            let hint = if dur.is_finite() && dur > 0.0 {
                Some(dur)
            } else {
                None
            };
            return Some(SegmentHit {
                index: idx,
                local_seconds: local,
                duration_seconds_hint: hint,
            });
        }
        prev_end = end;
    }

    let last_idx = segments.len().saturating_sub(1);
    let last_end = *end_targets.last().unwrap_or(&0.0);
    let last_start = if last_idx > 0 {
        end_targets.get(last_idx - 1).copied().unwrap_or(0.0)
    } else {
        0.0
    };
    if !last_end.is_finite() || !last_start.is_finite() || last_end <= last_start {
        return None;
    }
    let dur = (last_end - last_start).max(0.0);
    let hint = if dur.is_finite() && dur > 0.0 {
        Some(dur)
    } else {
        None
    };
    Some(SegmentHit {
        index: last_idx,
        local_seconds: (s - last_start).max(0.0),
        duration_seconds_hint: hint,
    })
}

fn best_effort_processed_seconds(job: &TranscodeJob) -> Option<f64> {
    let duration = job
        .media_info
        .as_ref()
        .and_then(|m| m.duration_seconds)
        .filter(|d| d.is_finite() && *d > 0.0);

    let from_wait = job.wait_metadata.as_ref().and_then(|m| {
        m.last_progress_out_time_seconds
            .filter(|s| s.is_finite() && *s > 0.0)
            .or_else(|| m.processed_seconds.filter(|s| s.is_finite() && *s > 0.0))
    });

    if let Some(v) = from_wait {
        return Some(duration.map_or(v, |d| v.min(d)));
    }

    duration.and_then(|d| {
        if job.progress.is_finite() && job.progress > 0.0 {
            Some(((job.progress / 100.0) * d).clamp(0.0, d))
        } else {
            None
        }
    })
}

pub(super) fn build_output_segments_with_active(job: &TranscodeJob) -> Vec<String> {
    let mut segments = ordered_job_segments(job);
    if job.status == JobStatus::Processing
        && let Some(active) = job_active_segment_path(job)
        && segments.last().is_none_or(|p| p != &active)
        && !segments.iter().any(|p| p == &active)
    {
        segments.push(active);
    }
    segments
}

pub(super) fn build_segment_end_targets_best_effort(
    job: &TranscodeJob,
    tools: &ExternalToolSettings,
    segments: &[String],
    clamped_seconds: f64,
) -> Option<Vec<f64>> {
    if segments.is_empty() {
        return None;
    }

    let processed_end = best_effort_processed_seconds(job).unwrap_or(clamped_seconds.max(0.0));

    if let Some(meta) = job.wait_metadata.as_ref()
        && let Some(targets) = meta.segment_end_targets.as_ref()
    {
        let valid = targets.iter().copied().all(|v| v.is_finite() && v > 0.0);
        if valid {
            if targets.len() == segments.len() {
                return Some(targets.clone());
            }
            if targets.len() + 1 == segments.len() && job.status == JobStatus::Processing {
                let last = targets.last().copied().unwrap_or(0.0);
                let mut out = targets.clone();
                let next = processed_end.max(last + 0.000_001);
                out.push(next);
                return Some(out);
            }
        }
    }

    let mut end_targets: Vec<f64> = Vec::with_capacity(segments.len());
    let mut total = 0.0_f64;
    for (idx, seg) in segments.iter().enumerate() {
        let path = std::path::Path::new(seg);
        let dur = probe_video_duration_seconds_best_effort(path, tools).ok();
        let Some(d) = dur.filter(|v| v.is_finite() && *v > 0.0) else {
            if idx + 1 == segments.len() && job.status == JobStatus::Processing {
                let last = end_targets.last().copied().unwrap_or(0.0);
                end_targets.push(processed_end.max(last + 0.000_001));
            }
            break;
        };
        total += d;
        if total.is_finite() && total > 0.0 {
            end_targets.push(total);
        } else {
            break;
        }
    }

    if end_targets.len() == segments.len() {
        Some(end_targets)
    } else {
        None
    }
}
