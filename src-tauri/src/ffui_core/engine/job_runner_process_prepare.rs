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
        job_wait_metadata,
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
        mark_smart_scan_child_processed(inner, job_id);
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
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(inner, job_id);
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
                job.logs.push(format!(
                    "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
                ));
                recompute_log_tail(job);
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
        // Smart Scan), falling back to the deterministic helper for older
        // manual jobs.
        let state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get(job_id) {
            if let Some(ref out) = job.output_path {
                PathBuf::from(out)
            } else {
                build_video_output_path(&input_path)
            }
        } else {
            build_video_output_path(&input_path)
        }
    };
    let base_tmp_output = build_video_tmp_output_path(&input_path);
    // Determine whether this run should resume from a previous partial output
    // segment. When we have both a known temp output path and a meaningful
    // processed duration, we treat the job as resumable; otherwise we fall
    // back to a fresh transcode from 0%.
    let mut resume_from_seconds: Option<f64> = None;
    let mut existing_segment: Option<PathBuf> = None;

    if let Some(meta) = job_wait_metadata
        && let Some(tmp) = meta.tmp_output_path.as_ref()
    {
        let path = PathBuf::from(tmp);
        if path.exists() {
            if let Some(processed) = meta.processed_seconds {
                if processed.is_finite() && processed > 0.0 {
                    resume_from_seconds = Some(processed);
                    existing_segment = Some(path);
                }
            } else if let (Some(pct), Some(total)) =
                (meta.last_progress_percent, media_info.duration_seconds)
                && pct.is_finite()
                && pct > 0.0
                && total.is_finite()
                && total > 0.0
            {
                let processed = (pct / 100.0) * total;
                if processed > 0.0 {
                    resume_from_seconds = Some(processed);
                    existing_segment = Some(path);
                }
            }
        }
    }

    let tmp_output = if existing_segment.is_some() {
        build_video_resume_tmp_output_path(&input_path)
    } else {
        base_tmp_output.clone()
    };
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
            }
            if matches!(job.job_type, JobType::Video) {
                let tmp_str = tmp_output.to_string_lossy().into_owned();
                match job.wait_metadata.as_mut() {
                    Some(meta) => {
                        if meta.tmp_output_path.is_none() {
                            meta.tmp_output_path = Some(tmp_str.clone());
                        }
                    }
                    None => {
                        job.wait_metadata = Some(WaitMetadata {
                            last_progress_percent: None,
                            processed_seconds: None,
                            tmp_output_path: Some(tmp_str.clone()),
                        });
                    }
                }
            }
            state
                .media_info_cache
                .insert(job_filename.clone(), media_info.clone());
        }
    }

    // Broadcast an updated queue snapshot with media metadata and preview path
    // before starting the heavy ffmpeg transcode so the UI can show thumbnails
    // and basic info as soon as a job enters Processing.
    notify_queue_listeners(inner);

    // For resumed jobs, derive an effective preset that seeks into the input
    // at the last known processed position using an input-side `-ss` so the
    // new segment continues where the previous temp output stopped. When the
    // preset already defines a custom output-side seek we fall back to a
    // fresh run to avoid surprising overrides.
    let mut effective_preset = preset.clone();
    if let Some(offset) = resume_from_seconds {
        let mut clone = preset.clone();
        match clone.input {
            Some(ref mut timeline) => {
                use crate::ffui_core::domain::SeekMode;
                match timeline.seek_mode {
                    None | Some(SeekMode::Input) => {
                        timeline.seek_mode = Some(SeekMode::Input);
                        timeline.seek_position = Some(format!("{offset:.3}"));
                        if timeline.accurate_seek.is_none() {
                            timeline.accurate_seek = Some(true);
                        }
                        effective_preset = clone;
                    }
                    Some(SeekMode::Output) => {
                        // Preserve caller-provided output-side seeking; disable
                        // automatic resume for such advanced timelines.
                        resume_from_seconds = None;
                        existing_segment = None;
                        effective_preset = preset.clone();
                    }
                }
            }
            None => {
                use crate::ffui_core::domain::{InputTimelineConfig, SeekMode};
                let timeline = InputTimelineConfig {
                    seek_mode: Some(SeekMode::Input),
                    seek_position: Some(format!("{offset:.3}")),
                    duration_mode: None,
                    duration: None,
                    accurate_seek: Some(true),
                };
                clone.input = Some(timeline);
                effective_preset = clone;
            }
        }
    }

    Ok(Some(PreparedTranscodeJob {
        input_path,
        settings_snapshot,
        preset: effective_preset,
        original_size_bytes,
        preset_id,
        output_path,
        resume_from_seconds,
        existing_segment,
        tmp_output,
        total_duration,
        ffmpeg_path: ffmpeg_path.clone(),
        ffmpeg_source: ffmpeg_source.clone(),
    }))
}
