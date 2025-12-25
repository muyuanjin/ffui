include!("job_runner_process_prepare_plan_resume_paths.rs");

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

    let container = preset
        .container
        .get_or_insert(crate::ffui_core::domain::ContainerConfig {
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
        job_type,
        preset_id,
        cached_media_info,
        job_filename,
        mut job_wait_metadata,
    ) = {
        let state = inner.state.lock_unpoisoned();
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return Ok(None),
        };

        let preset = state
            .presets
            .iter()
            .find(|p| p.id == job.preset_id)
            .cloned();
        let cached_media_info = state.media_info_cache.get(&job.filename).cloned();

        (
            PathBuf::from(&job.filename),
            preset,
            state.settings.clone(),
            job.job_type,
            job.preset_id.clone(),
            cached_media_info,
            job.filename.clone(),
            job.wait_metadata,
        )
    };

    let original_size_bytes = fs::metadata(&job_filename).map(|m| m.len()).unwrap_or(0);

    if job_type != JobType::Video {
        // For now, only video jobs are processed by the background worker.
        {
            let mut state = inner.state.lock_unpoisoned();
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

    let Some(preset) = preset else {
        {
            let mut state = inner.state.lock_unpoisoned();
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
            let mut state = inner.state.lock_unpoisoned();
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
        let state = inner.state.lock_unpoisoned();
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

    let backtrack_seconds = {
        let mut backtrack = settings_snapshot.effective_resume_backtrack_seconds();
        if job_wait_metadata.is_some()
            && let Some(gop) = preset.video.gop_size
            && gop > 0
            && let Some(fps) = media_info.frame_rate.filter(|v| v.is_finite() && *v > 0.0)
        {
            let gop_seconds = f64::from(gop) / fps;
            if gop_seconds.is_finite() && gop_seconds > backtrack {
                backtrack = gop_seconds;
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!(
                            "resume: increased backtrack to {backtrack:.3}s to match GOP duration (gop={gop}, fps={fps:.3})"
                        ),
                    );
                }
            }
        }
        backtrack
    };

    // If the job has existing partial segments (paused/crash recovery), recompute
    // processed_seconds based on recorded join targets (preferred) or segment
    // durations as a fallback. This keeps the restart-based resume boundary
    // stable across pauses/resumes.
    if let Some(meta) = job_wait_metadata.as_mut() {
        let corrected = recompute_processed_seconds_from_segments(
            meta,
            &settings_snapshot,
            media_info.duration_seconds,
            backtrack_seconds,
        );
        if corrected {
            let processed = meta.processed_seconds.unwrap_or(0.0);
            let mut state = inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id)
                && let Some(job_meta) = job.wait_metadata.as_mut()
            {
                job_meta.processed_seconds = Some(processed);
                // Align join target with the corrected processed seconds so
                // crash recovery and future resume planning stay consistent.
                job_meta.target_seconds = Some(processed);
                job_meta.segments.clone_from(&meta.segments);
                job_meta.tmp_output_path.clone_from(&meta.tmp_output_path);
                job_meta
                    .segment_end_targets
                    .clone_from(&meta.segment_end_targets);
                super::worker_utils::append_job_log_line(
                    job,
                    format!("resume: recomputed processedSeconds from partial segments: {processed:.6}s"),
                );
            }
        }
    }
    let (
        mut resume_target_seconds,
        mut existing_segments,
        mut existing_segment_end_targets,
        tmp_output,
        mut resume_plan,
    ) =
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
        let mut state = inner.state.lock_unpoisoned();
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
                        if segs.last() != Some(&tmp_str) {
                            segs.push(tmp_str);
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
                            segments: Some(vec![tmp_str]),
                            segment_end_targets: None,
                        });
                    }
                }
            }
            state
                .media_info_cache
                .insert(job_filename, media_info);
        }
    }
    // Broadcast an updated queue snapshot with media metadata and preview path before starting the heavy ffmpeg transcode.
    notify_queue_listeners(inner);

    let (effective_preset, finalize_preset, finalize_with_source_audio) =
        build_effective_preset_for_resume(
            ResumePresetBuildContext {
                inner,
                job_id,
                input_path: &input_path,
                settings_snapshot: &settings_snapshot,
                output_path: &output_path,
                resume_target_seconds: &mut resume_target_seconds,
                resume_plan: &mut resume_plan,
                existing_segments: &mut existing_segments,
            },
            &preset,
        );
    if existing_segments.len() != existing_segment_end_targets.len() {
        existing_segment_end_targets.truncate(existing_segments.len());
    }

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
        segment_end_targets: existing_segment_end_targets,
        tmp_output,
        total_duration,
        ffmpeg_path,
        ffmpeg_source,
    }))
}
