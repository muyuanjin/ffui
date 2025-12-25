pub(super) fn probe_segment_duration_seconds(path: &Path, settings: &AppSettings) -> Option<f64> {
    detect_video_stream_duration_seconds(path, settings)
        .or_else(|_| detect_duration_seconds(path, settings))
        .ok()
        .filter(|d| d.is_finite() && *d > 0.0)
}

pub(super) fn derive_segment_end_targets_from_durations(durations: &[f64]) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::with_capacity(durations.len());
    let mut total = 0.0;
    for d in durations {
        if !d.is_finite() || *d <= 0.0 {
            break;
        }
        total += d;
        out.push(total);
    }
    out
}

pub(super) fn should_apply_crash_recovery_rollback(meta: &WaitMetadata) -> bool {
    meta.processed_wall_millis.is_none()
        && meta.last_progress_percent.is_none()
        && meta.target_seconds.is_none()
        && meta.processed_seconds.is_none()
        && meta
            .segment_end_targets
            .as_ref()
            .map(|v| v.is_empty())
            .unwrap_or(true)
}

pub(super) fn maybe_apply_crash_recovery_rollback(
    end_targets: &mut [f64],
    rollback_seconds: f64,
) -> bool {
    const MIN_GAP_SECONDS: f64 = 0.05;
    if end_targets.is_empty() || !rollback_seconds.is_finite() || rollback_seconds <= 0.0 {
        return false;
    }
    let prev = end_targets
        .get(end_targets.len().saturating_sub(2))
        .copied()
        .unwrap_or(0.0);
    let last = end_targets[end_targets.len() - 1];
    if !last.is_finite() || !prev.is_finite() || last <= prev + MIN_GAP_SECONDS {
        return false;
    }
    let candidate = last - rollback_seconds;
    if candidate > prev + MIN_GAP_SECONDS {
        end_targets[end_targets.len() - 1] = candidate;
        true
    } else {
        false
    }
}

fn ordered_wait_metadata_segments(meta: &WaitMetadata) -> Vec<String> {
    if let Some(segs) = meta.segments.as_ref()
        && !segs.is_empty()
    {
        return segs.iter().map(std::string::ToString::to_string).collect();
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
    crash_recovery_rollback_seconds: f64,
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

            let clamped = media_duration
                .filter(|d| d.is_finite() && *d > 0.0)
                .map_or(target, |limit| target.min(limit));
            let prior = meta.processed_seconds.unwrap_or(0.0);
            meta.processed_seconds = Some(clamped);
            meta.target_seconds = Some(clamped);
            meta.segments = Some(valid_segments.clone());
            meta.tmp_output_path = valid_segments
                .last()
                .cloned()
                .or_else(|| meta.tmp_output_path.clone());
            meta.segment_end_targets =
                (!valid_end_targets.is_empty()).then_some(valid_end_targets);
            return (clamped - prior).abs() > 0.000_5;
        }
    }

    let mut total = 0.0;
    let mut valid_segments: Vec<String> = Vec::new();
    let mut durations: Vec<f64> = Vec::new();

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
        durations.push(dur);
    }

    if valid_segments.is_empty() || !total.is_finite() || total <= 0.0 {
        return false;
    }

    let clamped_total = media_duration
        .filter(|d| d.is_finite() && *d > 0.0)
        .map_or(total, |limit| total.min(limit));

    let prior = meta.processed_seconds.unwrap_or(0.0);
    let mut end_targets = derive_segment_end_targets_from_durations(&durations);

    if end_targets.len() == valid_segments.len() {
        let last_target = end_targets.last().copied().unwrap_or(clamped_total);
        let progress_hint = meta.target_seconds.or(meta.processed_seconds).or(Some(prior));
        let mut chosen = choose_processed_seconds_after_wait(
            media_duration,
            progress_hint,
            Some(last_target.min(clamped_total)),
        )
        .unwrap_or_else(|| last_target.min(clamped_total));

        // Crash recovery: by default rewind a few seconds and rely on overlap
        // + concat outpoint to remove any corruption/encoder-tail drift.
        if should_apply_crash_recovery_rollback(meta) {
            let rollback = crash_recovery_rollback_seconds
                .clamp(0.0, 10.0)
                .max(0.0);
            let _ = maybe_apply_crash_recovery_rollback(&mut end_targets, rollback);
            if let Some(last) = end_targets.last().copied() {
                chosen = chosen.min(last);
            }
        }

        // Keep concat targets consistent with the chosen resume boundary.
        if !end_targets.is_empty() {
            let last_idx = end_targets.len() - 1;
            let prev = end_targets
                .get(end_targets.len().saturating_sub(2))
                .copied()
                .unwrap_or(0.0);
            let clamped = chosen.min(clamped_total).max(prev + 0.000_001).max(0.0);
            let next_last = end_targets[last_idx].min(clamped).max(prev + 0.000_001);
            end_targets[last_idx] = next_last;
            chosen = next_last;
        }

        meta.segment_end_targets = Some(end_targets);
        meta.processed_seconds = Some(chosen);
        meta.target_seconds = Some(chosen);
    } else {
        // The probed total is a useful correction signal when it suggests the
        // stored offset is too small (overlap risk) or too large (skip risk).
        // Use the same drift-bounded chooser we apply at pause time so probing
        // cannot push the resume point far forward unexpectedly.
        let chosen =
            choose_processed_seconds_after_wait(media_duration, Some(prior), Some(clamped_total))
                .unwrap_or(clamped_total);
        meta.processed_seconds = Some(chosen);
        meta.target_seconds = Some(chosen);
    }
    meta.segments = Some(valid_segments.clone());
    meta.tmp_output_path = valid_segments
        .last()
        .cloned()
        .or_else(|| meta.tmp_output_path.clone());

    // Treat this as a correction when it meaningfully changes the offset.
    (meta.processed_seconds.unwrap_or(0.0) - prior).abs() > 0.000_5
}

pub(super) fn choose_processed_seconds_after_wait(
    media_duration: Option<f64>,
    progress_out_time_seconds: Option<f64>,
    probed_segment_end_seconds: Option<f64>,
) -> Option<f64> {
    let clamp_max = media_duration.filter(|d| d.is_finite() && *d > 0.0);
    let progress = progress_out_time_seconds
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| clamp_max.map_or_else(|| v.max(0.0), |max| v.clamp(0.0, max)));
    let probed = probed_segment_end_seconds
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| clamp_max.map_or_else(|| v.max(0.0), |max| v.clamp(0.0, max)));

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
