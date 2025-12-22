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
    // The probed total is a useful correction signal when it suggests the
    // stored offset is too small (overlap risk) or too large (skip risk).
    // Use the same drift-bounded chooser we apply at pause time so probing
    // cannot push the resume point far forward unexpectedly.
    let chosen = choose_processed_seconds_after_wait(media_duration, Some(prior), Some(clamped_total))
        .unwrap_or(clamped_total);
    meta.processed_seconds = Some(chosen);
    meta.segments = Some(valid_segments.clone());
    meta.tmp_output_path = valid_segments.last().cloned().or(meta.tmp_output_path.clone());

    // Treat this as a correction when it meaningfully changes the offset.
    (chosen - prior).abs() > 0.000_5
}

pub(super) fn choose_processed_seconds_after_wait(
    media_duration: Option<f64>,
    progress_out_time_seconds: Option<f64>,
    probed_segment_end_seconds: Option<f64>,
) -> Option<f64> {
    const MAX_TIMESTAMP_DRIFT_SECONDS: f64 = 0.10;

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
            // We have two candidates for the "absolute" processed position:
            // - ffmpeg `out_time` (progress stream)
            // - probed segment end (ffprobe on the muxed segment)
            //
            // In practice, either source can be wrong depending on container,
            // B-frame delay, stream-copy tails, and timestamp reset behavior.
            // The most harmful error is seeking too far forward, because it
            // drops video frames and accumulates with repeated pause/resume.
            //
            // Strategy:
            // - If probed is *materially ahead* of progress, treat probed as
            //   suspicious and prefer progress to avoid skipping.
            // - If progress is *materially ahead* of probed, treat progress as
            //   non-video tail (e.g. copied audio) and prefer probed.
            // - Otherwise, take the max to avoid small overlaps from B-frame lag.
            let delta = probed_end - progress_end;
            if delta > MAX_TIMESTAMP_DRIFT_SECONDS {
                Some(progress_end)
            } else if delta < -MAX_TIMESTAMP_DRIFT_SECONDS {
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
