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
                    "resume plan: strategy={strategy} target={:.6}s seek={:.6}s trimStart={:.6}s backtrack={:.3}s",
                    plan.target_seconds,
                    plan.seek_seconds,
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

