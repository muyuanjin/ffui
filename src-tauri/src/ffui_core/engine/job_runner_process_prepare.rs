pub(super) fn plan_resume_paths(
    job_id: &str,
    input_path: &Path,
    output_path: &Path,
    media_duration: Option<f64>,
    wait_meta: Option<&WaitMetadata>,
    container_format: Option<&str>,
    backtrack_seconds: f64,
) -> (Option<f64>, Vec<PathBuf>, PathBuf, Option<ResumePlan>) {
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
    let mut recorded_segment_count: u64 = 0;

    if let Some(meta) = wait_meta {
        // 1) 计算 join target（边界点），用于规划恢复（可能 overlap+trim）。
        if let Some(target) = meta.target_seconds.or(meta.processed_seconds) {
            if target.is_finite() && target > 0.0 {
                resume_target_seconds = Some(target);
            }
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
            for s in segs {
                let path = PathBuf::from(s);
                if path.exists() {
                    existing_segments.push(path);
                }
            }
        }

        if existing_segments.is_empty()
            && let Some(tmp) = meta.tmp_output_path.as_ref()
        {
            recorded_segment_count = recorded_segment_count.max(1);
            let path = PathBuf::from(tmp);
            if path.exists() {
                existing_segments.push(path);
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
                return (None, Vec::new(), candidate, None);
            }
            idx = idx.saturating_add(1);
        }
    }

    let target_seconds = resume_target_seconds.unwrap_or(0.0).max(0.0);
    let backtrack_seconds = if backtrack_seconds.is_nan() {
        0.0
    } else {
        backtrack_seconds.clamp(0.0, 10.0)
    };
    let seek_seconds = (target_seconds - backtrack_seconds).max(0.0);
    let trim_start_seconds = (target_seconds - seek_seconds).max(0.0);

    let resume_plan = ResumePlan {
        target_seconds,
        seek_seconds,
        trim_start_seconds,
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
            return (resume_target_seconds, existing_segments, candidate, Some(resume_plan));
        }
        idx = idx.saturating_add(1);
    }
}

/// 为 mp4/mov 输出启用 fragmented MP4 相关 movflags，提升在崩溃或异常中断时
/// 临时分段文件的可读性与可 concat 性。
///
/// 这里不会移除用户已经配置的 movflags，只会在缺失时追加
/// `frag_keyframe` 与 `empty_moov` 两个标志。
fn ensure_fragmented_movflags_for_mp4_like_output(
    preset: &mut crate::ffui_core::domain::FFmpegPreset,
    output_path: &Path,
) {
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // 只针对 mp4/mov 系列容器启用 fragmented movflags。
    if ext != "mp4" && ext != "mov" && ext != "m4v" {
        return;
    }

    use crate::ffui_core::domain::ContainerConfig;

    let container = preset
        .container
        .get_or_insert(ContainerConfig {
            format: None,
            movflags: None,
        });

    let mut flags = container.movflags.clone().unwrap_or_default();
    let mut ensure_flag = |flag: &str| {
        if !flags.iter().any(|f| f == flag) {
            flags.push(flag.to_string());
        }
    };

    ensure_flag("frag_keyframe");
    ensure_flag("empty_moov");

    container.movflags = Some(flags);
}

fn prepare_transcode_job(inner: &Inner, job_id: &str) -> Result<Option<PreparedTranscodeJob>> {
    let (
        input_path,
        preset,
        settings_snapshot,
        original_size_bytes,
        job_type,
        preset_id,
        cached_media_info,
        job_filename,
        mut job_wait_metadata,
    ) = {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return Ok(None),
        };

        let preset = state
            .presets
            .iter()
            .find(|p| p.id == job.preset_id)
            .cloned();
        let original_size_bytes = fs::metadata(&job.filename).map(|m| m.len()).unwrap_or(0);
        let cached_media_info = state.media_info_cache.get(&job.filename).cloned();

        (
            PathBuf::from(&job.filename),
            preset,
            state.settings.clone(),
            original_size_bytes,
            job.job_type.clone(),
            job.preset_id.clone(),
            cached_media_info,
            job.filename.clone(),
            job.wait_metadata.clone(),
        )
    };

    if job_type != JobType::Video {
        // For now, only video jobs are processed by the background worker.
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                job.skip_reason =
                    Some("Only video jobs are processed by the ffmpeg worker".to_string());
            }
        }
        mark_batch_compress_child_processed(inner, job_id);
        return Ok(None);
    }

    let preset = match preset {
        Some(p) => p,
        None => {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("No preset found for preset id '{preset_id}'");
                    job.failure_reason = Some(reason.clone());
                    super::worker_utils::append_job_log_line(job, reason);
                }
            }
            mark_batch_compress_child_processed(inner, job_id);
            return Ok(None);
        }
    };

    // Ensure ffmpeg is available, honoring auto-download / update settings.
    // `ffmpeg_source` is used to decide whether it is safe to enable newer
    // CLI flags such as `-stats_period` which are guaranteed to exist on the
    // auto-downloaded static builds we ship, but may not be present on very
    // old custom ffmpeg binaries provided by the user.
    let (ffmpeg_path, ffmpeg_source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings_snapshot.tools)?;

    if did_download {
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                super::worker_utils::append_job_log_line(
                    job,
                    format!(
                    "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
                ),
                );
            }
        }
        // Persist metadata for the newly downloaded ffmpeg binary.
        record_tool_download_with_inner(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

    // Build or reuse cached media metadata for the input so the UI can show
    // duration/codec/size without repeated ffprobe calls for the same file.
    let mut media_info = cached_media_info.unwrap_or(MediaInfo {
        duration_seconds: None,
        width: None,
        height: None,
        frame_rate: None,
        video_codec: None,
        audio_codec: None,
        size_mb: if original_size_bytes > 0 {
            Some(original_size_bytes as f64 / (1024.0 * 1024.0))
        } else {
            None
        },
    });

    if media_info.duration_seconds.is_none()
        && let Ok(d) = detect_duration_seconds(&input_path, &settings_snapshot)
    {
        media_info.duration_seconds = Some(d);
    }

    if media_info.video_codec.is_none()
        && let Ok(codec) = detect_video_codec(&input_path, &settings_snapshot)
    {
        media_info.video_codec = Some(codec);
    }

    if (media_info.width.is_none()
        || media_info.height.is_none()
        || media_info.frame_rate.is_none())
        && let Ok((width, height, frame_rate)) =
            detect_video_dimensions_and_frame_rate(&input_path, &settings_snapshot)
    {
        if media_info.width.is_none() {
            media_info.width = width;
        }
        if media_info.height.is_none() {
            media_info.height = height;
        }
        if media_info.frame_rate.is_none() {
            media_info.frame_rate = frame_rate;
        }
    }

    let output_path = {
        // Prefer a job-specific output path when provided (for example from
        // Batch Compress), falling back to the deterministic helper for older
        // manual jobs.
        let state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get(job_id) {
            if let Some(ref out) = job.output_path {
                PathBuf::from(out)
            } else {
                build_video_output_path(
                    &input_path,
                    preset
                        .container
                        .as_ref()
                        .and_then(|c| c.format.as_deref()),
                )
            }
        } else {
            build_video_output_path(
                &input_path,
                preset
                    .container
                    .as_ref()
                    .and_then(|c| c.format.as_deref()),
            )
        }
    };

    // If the job has existing partial segments (paused/crash recovery), recompute
    // processed_seconds based on the actual segment durations. This avoids the
    // resume seek point drifting backwards when ffmpeg's -progress out_time
    // lags behind the final muxed frames (common with B-frames).
    if let Some(meta) = job_wait_metadata.as_mut() {
        let corrected =
            recompute_processed_seconds_from_segments(meta, &settings_snapshot, media_info.duration_seconds);
	        if corrected {
	            let processed = meta.processed_seconds.unwrap_or(0.0);
	            let mut state = inner.state.lock().expect("engine state poisoned");
	            if let Some(job) = state.jobs.get_mut(job_id)
	                && let Some(job_meta) = job.wait_metadata.as_mut()
	            {
		                job_meta.processed_seconds = Some(processed);
                    // Align join target with the corrected processed seconds so
                    // crash recovery and future resume planning stay consistent.
                    job_meta.target_seconds = Some(processed);
		                job_meta.segments = meta.segments.clone();
		                job_meta.tmp_output_path = meta.tmp_output_path.clone();
		                super::worker_utils::append_job_log_line(
		                    job,
		                    format!(
	                        "resume: recomputed processedSeconds from segment durations: {processed:.6}s"
	                    ),
	                );
	            }
	        }
	    }

    let backtrack_seconds = settings_snapshot.effective_resume_backtrack_seconds();
    let (mut resume_target_seconds, mut existing_segments, tmp_output, mut resume_plan) =
        plan_resume_paths(
        job_id,
        &input_path,
        &output_path,
        media_info.duration_seconds,
        job_wait_metadata.as_ref(),
        preset
            .container
            .as_ref()
            .and_then(|c| c.format.as_deref()),
        backtrack_seconds,
    );
    // Prefer duration from ffprobe when available, but allow the ffmpeg
    // stderr metadata lines (e.g. "Duration: 00:01:29.95, ...") to fill this
    // in later if ffprobe is missing or fails on the current file.
    let total_duration = media_info.duration_seconds;
    let preview_path = generate_preview_for_video(
        &input_path,
        &ffmpeg_path,
        total_duration,
        settings_snapshot.preview_capture_percent,
    );

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.input_path = Some(input_path.to_string_lossy().into_owned());
            job.output_path = Some(output_path.to_string_lossy().into_owned());
            job.media_info = Some(media_info.clone());
            if let Some(preview) = &preview_path {
                job.preview_path = Some(preview.to_string_lossy().into_owned());
                job.preview_revision = job.preview_revision.saturating_add(1);
            }
            if matches!(job.job_type, JobType::Video) {
                let tmp_str = tmp_output.to_string_lossy().into_owned();
                match job.wait_metadata.as_mut() {
                    Some(meta) => {
                        // Record the temp output path for the current run so crash
                        // recovery can pick it up even if ffmpeg is interrupted.
                        meta.tmp_output_path = Some(tmp_str.clone());
                        let mut segs = meta.segments.clone().unwrap_or_default();
                        if segs.last().map(|s| s != &tmp_str).unwrap_or(true) {
                            segs.push(tmp_str.clone());
                        }
                        meta.segments = Some(segs);
                    }
                    None => {
                        job.wait_metadata = Some(WaitMetadata {
                            last_progress_percent: None,
                            processed_wall_millis: None,
                            processed_seconds: None,
                            target_seconds: None,
                            tmp_output_path: Some(tmp_str.clone()),
                            segments: Some(vec![tmp_str.clone()]),
                        });
                    }
                }
            }
            state
                .media_info_cache
                .insert(job_filename.clone(), media_info.clone());
        }
    }
    // Broadcast an updated queue snapshot with media metadata and preview path before starting the heavy ffmpeg transcode.
    notify_queue_listeners(inner);

    let (effective_preset, finalize_preset, finalize_with_source_audio) =
        build_effective_preset_for_resume(
            inner,
            job_id,
            &preset,
            &output_path,
            &mut resume_target_seconds,
            &mut resume_plan,
            &mut existing_segments,
        );

    Ok(Some(PreparedTranscodeJob {
        input_path,
        settings_snapshot,
        preset: effective_preset,
        finalize_preset,
        original_size_bytes,
        preset_id,
        output_path,
        resume_target_seconds,
        resume_plan,
        finalize_with_source_audio,
        existing_segments,
        tmp_output,
        total_duration,
        ffmpeg_path: ffmpeg_path.clone(),
        ffmpeg_source: ffmpeg_source.clone(),
    }))
}
