fn log_resume_plan_and_normalize_segments(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    resume_plan: Option<&ResumePlan>,
    finalize_with_source_audio: bool,
    existing_segments: &[PathBuf],
) {
    if let Some(plan) = resume_plan {
        let strategy = match plan.strategy {
            ResumeStrategy::LegacySeek => "legacy_seek",
            ResumeStrategy::OverlapTrim => "overlap_trim",
        };
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "resume plan: strategy={strategy} target={:.6}s seek={:.6}s trimAt={:.6}s trimRel={:.6}s backtrack={:.3}s",
                    plan.target_seconds,
                    plan.seek_seconds,
                    plan.trim_at_seconds,
                    plan.trim_start_seconds,
                    plan.backtrack_seconds
                ),
            );
            if finalize_with_source_audio {
                super::worker_utils::append_job_log_line(
                    job,
                    "resume: final output will mux audio from source input (segments are video-only)".to_string(),
                );
            }
        }
    }

    if finalize_with_source_audio && !existing_segments.is_empty() {
        for seg in existing_segments {
            if let Err(err) = remux_segment_drop_audio(ffmpeg_path, seg.as_path()) {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!(
                            "resume: warning: failed to remux prior segment to drop audio ({}): {err:#}",
                            seg.display()
                        ),
                    );
                }
            }
        }
    }
}

fn remux_wait_segment_or_log(inner: &Inner, job_id: &str, ffmpeg_path: &str, tmp_output: &Path) {
    if let Err(err) = remux_segment_drop_audio(ffmpeg_path, tmp_output) {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "wait: warning: failed to remux segment to drop audio ({}): {err:#}",
                    tmp_output.display()
                ),
            );
        }
    }
}

fn maybe_insert_copyts_for_overlap_trim(args: &mut Vec<String>, resume_plan: Option<ResumePlan>) {
    // For overlap+trim resume, keep source timestamps so the trim filter can
    // cut at an absolute target time that is stable across `-ss` seek jitter.
    if let Some(plan) = resume_plan
        && matches!(plan.strategy, ResumeStrategy::OverlapTrim)
    {
        let insert_at = args
            .iter()
            .position(|a| a == "-ss")
            .or_else(|| args.iter().position(|a| a == "-i"))
            .unwrap_or(0);
        if !args.iter().any(|a| a == "-copyts") {
            args.insert(insert_at, "-copyts".to_string());
        }
    }
}

fn derive_resume_concat_segment_durations(
    segment_end_targets: &[f64],
    all_segments_len: usize,
) -> Option<Vec<f64>> {
    // `segment_end_targets` contains the join target time after each completed
    // segment in `existing_segments` (i.e. all but the final segment).
    if all_segments_len < 2 || segment_end_targets.len() + 1 != all_segments_len {
        return None;
    }

    let mut prev = 0.0;
    let mut durations: Vec<f64> = Vec::with_capacity(segment_end_targets.len());
    for end in segment_end_targets {
        if !end.is_finite() || *end <= prev {
            return None;
        }
        durations.push(end - prev);
        prev = *end;
    }
    Some(durations)
}

fn maybe_inject_stats_period_for_download(
    cmd: &mut Command,
    args: &mut Vec<String>,
    settings_snapshot: &AppSettings,
    ffmpeg_source: &str,
) {
    // Increase structured progress update frequency for the bundled ffmpeg
    // binary so `job.progress` has a higher reporting rate without inventing
    // synthetic percentages. Old custom ffmpeg builds may not support this
    // flag, so we only apply it for the known static download source.
    if ffmpeg_source != "download" {
        return;
    }

    let interval_ms = settings_snapshot
        .progress_update_interval_ms
        .unwrap_or(DEFAULT_PROGRESS_UPDATE_INTERVAL_MS);
    // Clamp into a sensible range [50ms, 2000ms] to avoid extreme values.
    let clamped_ms = interval_ms.clamp(50, 2000) as f64;
    let stats_period_secs = clamped_ms / 1000.0;
    let stats_arg = format!("{stats_period_secs:.3}");
    cmd.arg("-stats_period").arg(&stats_arg);
    // 确保日志中记录的命令与实际执行的命令完全一致：包括 -stats_period 参数。
    args.insert(0, stats_arg);
    args.insert(0, "-stats_period".to_string());
}
