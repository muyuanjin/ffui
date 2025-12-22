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
    // If the job already recorded per-segment join targets, prefer them over
    // probing durations from container metadata (which can drift by 1–2 frames
    // on VFR/B-frame content).
    if let Some(end_targets) = meta.segment_end_targets.as_ref()
        && !end_targets.is_empty()
    {
        let mut valid_segments: Vec<String> = Vec::new();
        let mut valid_end_targets: Vec<f64> = Vec::new();
        let mut last_target: Option<f64> = None;

        for (idx, raw) in ordered_wait_metadata_segments(meta).into_iter().enumerate() {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let path = PathBuf::from(trimmed);
            if !path.exists() {
                continue;
            }
            valid_segments.push(trimmed.to_string());
            let Some(t) = end_targets
                .get(idx)
                .copied()
                .filter(|v| v.is_finite() && *v > 0.0)
            else {
                // Without a matching end target we cannot reliably align the
                // timeline; fall back to duration probing below.
                valid_segments.clear();
                valid_end_targets.clear();
                last_target = None;
                break;
            };
            valid_end_targets.push(t);
            last_target = Some(t);
        }

        if let Some(mut target) = last_target {
            // Move the expensive ffprobe "pause calibration" into the resume
            // preparation phase: probe only the last segment and use it to
            // conservatively cap the final join target if needed (avoid skip).
            if let Some(last_seg) = valid_segments.last() {
                let base = valid_end_targets
                    .get(valid_end_targets.len().saturating_sub(2))
                    .copied()
                    .unwrap_or(0.0);
                let last_path = PathBuf::from(last_seg);
                if let Some(dur) = probe_segment_duration_seconds(&last_path, settings)
                    && dur.is_finite()
                    && dur > 0.0
                    && base.is_finite()
                    && base >= 0.0
                {
                    let probed_end = base + dur;
                    if probed_end.is_finite() && probed_end > 0.0 {
                        target = target.min(probed_end);
                        if let Some(last) = valid_end_targets.last_mut() {
                            *last = (*last).min(probed_end);
                        }
                    }
                }
            }

            let clamped = match media_duration.filter(|d| d.is_finite() && *d > 0.0) {
                Some(limit) => target.min(limit),
                None => target,
            };
            let prior = meta.processed_seconds.unwrap_or(0.0);
            meta.processed_seconds = Some(clamped);
            meta.target_seconds = Some(clamped);
            meta.segments = Some(valid_segments.clone());
            meta.tmp_output_path = valid_segments.last().cloned().or(meta.tmp_output_path.clone());
            meta.segment_end_targets =
                (!valid_end_targets.is_empty()).then_some(valid_end_targets);
            return (clamped - prior).abs() > 0.000_5;
        }
    }

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
    meta.target_seconds = Some(chosen);
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
            // Conservative join target selection: pick the earlier timestamp.
            //
            // Picking a later join target risks skipping video frames, and that
            // error accumulates with repeated pause/resume cycles. Picking an
            // earlier join target converts into overlap work on resume; the
            // concat list will clip prior segments to this target so the final
            // output remains contiguous.
            Some(probed_end.min(progress_end))
        }
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        _ => None,
    }
}
