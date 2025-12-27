pub(super) fn plan_resume_paths(
    job_id: &str,
    input_path: &Path,
    output_path: &Path,
    media_duration: Option<f64>,
    wait_meta: Option<&WaitMetadata>,
    container_format: Option<&str>,
    backtrack_seconds: f64,
) -> (Option<f64>, Vec<PathBuf>, Vec<f64>, PathBuf, Option<ResumePlan>) {
    const MAX_BACKTRACK_SECONDS: f64 = 30.0;
    // Use a per-job, per-segment temp output path so multiple pauses/resumes (or
    // duplicate enqueues for the same input) never collide on disk.
    let build_tmp = |idx: u64| {
        // Prefer locating temp segments next to the final output so renames stay atomic
        // even when outputs are routed to a different directory than the input.
        if output_path.exists() || output_path.parent() != input_path.parent() {
            build_video_job_segment_tmp_output_path_for_output(output_path, job_id, idx)
        } else {
            build_video_job_segment_tmp_output_path(input_path, container_format, job_id, idx)
        }
    };

    // 根据 WaitMetadata 计算“已处理秒数”和历史分段列表，以支撑多次暂停/继续。
    let mut resume_target_seconds: Option<f64> = None;
    let mut existing_segments: Vec<PathBuf> = Vec::new();
    let mut existing_segment_end_targets: Vec<f64> = Vec::new();
    let mut recorded_segment_count: u64 = 0;

    if let Some(meta) = wait_meta {
        let end_targets = meta.segment_end_targets.as_deref();
        // 1) 计算 join target（边界点），用于规划恢复（可能 overlap+trim）。
        if let Some(target) = meta.target_seconds.or(meta.processed_seconds) {
            if target.is_finite() && target > 0.0 {
                resume_target_seconds = Some(target);
            }
        } else if let Some(out_time) = meta.last_progress_out_time_seconds
            && out_time.is_finite()
            && out_time > 0.0
        {
            // Crash recovery: prefer ffmpeg progress out_time (absolute, already
            // includes any prior resume offsets) when pause metadata is missing.
            resume_target_seconds = Some(out_time);
        } else if let (Some(pct), Some(total)) = (meta.last_progress_percent, media_duration)
            && pct.is_finite()
            && pct > 0.0
            && total.is_finite()
            && total > 0.0
        {
            let processed = (pct / 100.0) * total;
            if processed > 0.0 {
                resume_target_seconds = Some(processed);
            }
        }

        // 2) 构建历史分段列表：优先使用 segments，回退到单一 tmp_output_path。
        if let Some(ref segs) = meta.segments {
            recorded_segment_count = segs.len() as u64;
            for (idx, s) in segs.iter().enumerate() {
                let path = PathBuf::from(s);
                if path.exists() {
                    existing_segments.push(path);
                    if let Some(t) = end_targets
                        .and_then(|v| v.get(idx))
                        .copied()
                        .filter(|t| t.is_finite() && *t > 0.0)
                    {
                        existing_segment_end_targets.push(t);
                    }
                }
            }
        }

        // If we have per-segment end targets aligned with existing segments,
        // prefer the last one as the effective resume boundary.
        if let Some(last) = existing_segment_end_targets
            .iter()
            .copied()
            .filter(|t| t.is_finite() && *t > 0.0)
            .next_back()
        {
            resume_target_seconds = Some(last);
        }

        if existing_segments.is_empty()
            && let Some(tmp) = meta.tmp_output_path.as_ref()
        {
            recorded_segment_count = recorded_segment_count.max(1);
            let path = PathBuf::from(tmp);
            if path.exists() {
                existing_segments.push(path);
                if let Some(target) = meta.target_seconds.or(meta.processed_seconds)
                    && target.is_finite()
                    && target > 0.0
                {
                    existing_segment_end_targets.push(target);
                }
            }
        }
    }

    // 无有效历史分段或缺乏位置信息时，回退为从 0% 开始的新一次转码。
    if existing_segments.is_empty() || resume_target_seconds.is_none() {
        // Even for a fresh run, ensure we pick a non-existent segment path in
        // case this job id previously crashed and left stale tmp files behind.
        let mut idx: u64 = recorded_segment_count;
        loop {
            let candidate = build_tmp(idx);
            if !candidate.exists() {
                return (None, Vec::new(), Vec::new(), candidate, None);
            }
            idx = idx.saturating_add(1);
        }
    }

    let target_seconds = resume_target_seconds.unwrap_or(0.0).max(0.0);
    let backtrack_seconds = if backtrack_seconds.is_nan() {
        0.0
    } else {
        backtrack_seconds.clamp(0.0, MAX_BACKTRACK_SECONDS)
    };
    let seek_seconds = (target_seconds - backtrack_seconds).max(0.0);
    let trim_start_seconds = (target_seconds - seek_seconds).max(0.0);

    let resume_plan = ResumePlan {
        target_seconds,
        seek_seconds,
        trim_start_seconds,
        trim_at_seconds: target_seconds,
        backtrack_seconds,
        strategy: if backtrack_seconds > 0.0 && trim_start_seconds > 0.0 {
            ResumeStrategy::OverlapTrim
        } else {
            ResumeStrategy::LegacySeek
        },
    };

    // Resumed run: pick the next available segment index (starting at the
    // recorded count) and skip any stale files that may exist from crashes.
    let mut idx: u64 = recorded_segment_count.max(existing_segments.len() as u64);
    loop {
        let candidate = build_tmp(idx);
        if !candidate.exists() {
            return (
                resume_target_seconds,
                existing_segments,
                existing_segment_end_targets,
                candidate,
                Some(resume_plan),
            );
        }
        idx = idx.saturating_add(1);
    }
}
