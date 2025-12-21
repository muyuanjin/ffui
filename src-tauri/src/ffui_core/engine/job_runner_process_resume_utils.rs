pub(super) fn probe_segment_duration_seconds(path: &Path, settings: &AppSettings) -> Option<f64> {
    detect_video_stream_duration_seconds(path, settings)
        .or_else(|_| detect_duration_seconds(path, settings))
        .ok()
        .filter(|d| d.is_finite() && *d > 0.0)
}

fn ordered_wait_metadata_segments(meta: &WaitMetadata) -> Vec<String> {
    if let Some(segs) = meta.segments.as_ref()
        && !segs.is_empty()
    {
        return segs.iter().map(|s| s.to_string()).collect();
    }
    meta.tmp_output_path
        .as_ref()
        .map(|s| vec![s.to_string()])
        .unwrap_or_default()
}

pub(super) fn recompute_processed_seconds_from_segments(
    meta: &mut WaitMetadata,
    settings: &AppSettings,
    media_duration: Option<f64>,
) -> bool {
    let mut total = 0.0;
    let mut valid_segments: Vec<String> = Vec::new();

    for raw in ordered_wait_metadata_segments(meta) {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if !path.exists() {
            continue;
        }
        let Some(dur) = probe_segment_duration_seconds(&path, settings) else {
            // Stop at the first unreadable segment so we do not treat later
            // segments as contiguous when the timeline would have a hole.
            break;
        };
        total += dur;
        valid_segments.push(trimmed.to_string());
    }

    if valid_segments.is_empty() || !total.is_finite() || total <= 0.0 {
        return false;
    }

    let clamped_total = match media_duration.filter(|d| d.is_finite() && *d > 0.0) {
        Some(limit) => total.min(limit),
        None => total,
    };

    let prior = meta.processed_seconds.unwrap_or(0.0);
    // Always prefer probed durations because ffmpeg's -progress out_time can lag
    // behind the last muxed frame when B-frames are enabled, leading to resume
    // overlap and single-frame glitches after concat.
    meta.processed_seconds = Some(clamped_total);
    meta.segments = Some(valid_segments.clone());
    meta.tmp_output_path = valid_segments.last().cloned().or(meta.tmp_output_path.clone());

    // Treat this as a correction when it meaningfully changes the offset.
    (clamped_total - prior).abs() > 0.000_5
}

pub(super) fn choose_processed_seconds_after_wait(
    media_duration: Option<f64>,
    progress_out_time_seconds: Option<f64>,
    probed_segment_end_seconds: Option<f64>,
) -> Option<f64> {
    let clamp_max = media_duration.filter(|d| d.is_finite() && *d > 0.0);
    let progress = progress_out_time_seconds
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| match clamp_max {
            Some(max) => v.clamp(0.0, max),
            None => v.max(0.0),
        });
    let probed = probed_segment_end_seconds
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| match clamp_max {
            Some(max) => v.clamp(0.0, max),
            None => v.max(0.0),
        });

    match (probed, progress) {
        (Some(probed_end), Some(progress_end)) => {
            // If ffmpeg's out_time is materially ahead of the probed video end,
            // it likely reflects a non-video stream tail (e.g. copied audio).
            // Using that larger timestamp as the resume seek point would skip
            // video frames after repeated pause/resume cycles.
            let suspect_non_video_tail = progress_end > probed_end + 0.2;
            if suspect_non_video_tail {
                Some(probed_end)
            } else {
                Some(probed_end.max(progress_end))
            }
        }
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        _ => None,
    }
}
