fn execute_transcode_job(
    inner: &Inner,
    job_id: &str,
    prepared: PreparedTranscodeJob,
) -> Result<()> {
    let PreparedTranscodeJob {
        input_path,
        settings_snapshot,
        preset,
        finalize_preset,
        original_size_bytes,
        preset_id,
        output_path,
        resume_target_seconds,
        resume_plan,
        finalize_with_source_audio,
        existing_segments,
        segment_end_targets,
        tmp_output,
        mut total_duration,
        ffmpeg_path,
        ffmpeg_source,
    } = prepared;
    let execution_start_time = SystemTime::now();
    set_job_progress_phase(inner, job_id, ProgressPhase::Transcoding, total_duration);

    let job_output_policy = {
        let state = inner.state.lock_unpoisoned();
        state
            .jobs
            .get(job_id)
            .and_then(|job| job.output_policy.clone())
    };
    let preserve_times_policy = job_output_policy
        .as_ref()
        .map(|p| p.preserve_file_times.clone())
        .unwrap_or_default();
    let input_times = input_file_times_for_policy(&preserve_times_policy, &input_path);
    log_resume_plan_and_normalize_segments(
        inner,
        job_id,
        &ffmpeg_path,
        resume_plan.as_ref(),
        finalize_with_source_audio,
        &existing_segments,
    );
    let two_pass_requested = preset_requires_two_pass(&preset);
    let mut two_pass_second_args = None;
    if two_pass_requested {
        let planned = plan_initial_two_pass_second_args(TwoPassPreludeArgs {
            inner,
            job_id,
            input_path: &input_path,
            tmp_output: &tmp_output,
            output_path: &output_path,
            preset: &preset,
            job_output_policy: job_output_policy.as_ref(),
            resume_plan: resume_plan.as_ref(),
            settings_snapshot: &settings_snapshot,
            ffmpeg_path: &ffmpeg_path,
            ffmpeg_source: &ffmpeg_source,
        })?;
        let Some(planned) = planned else {
            return Ok(());
        };
        two_pass_second_args = Some(planned);
    }
    let mut args = if let Some(args) = two_pass_second_args {
        args
    } else {
        validate_structured_execution_preset(&preset).map_err(anyhow::Error::msg)?;
        build_ffmpeg_args(&preset, &input_path, &tmp_output, false, job_output_policy.as_ref())
    };
    let mut two_pass_log_output = current_two_pass_log_output(&tmp_output);
    let two_pass_completed_segments = existing_segments.clone();
    if two_pass_requested {
        two_pass_log_output = rewrite_current_two_pass_log_prefix(&mut args, &tmp_output);
    }
    maybe_insert_copyts_for_overlap_trim(&mut args, resume_plan.as_ref());
    let mut audio_sidecar = if finalize_with_source_audio
        && !existing_segments.is_empty()
        && should_precompute_resumed_audio(&finalize_preset)
    {
        match start_audio_finalization_sidecar(
            inner,
            job_id,
            &ffmpeg_path,
            &input_path,
            &output_path,
            &finalize_preset,
        ) {
            Ok(sidecar) => Some(sidecar),
            Err(err) => {
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!(
                            "resume: warning: parallel audio finalization unavailable; falling back to serial final mux: {err:#}"
                        ),
                    );
                }
                None
            }
        }
    } else {
        None
    };
    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    maybe_inject_stats_period_for_download(
        inner,
        &mut args,
        &settings_snapshot,
        &ffmpeg_path,
        &ffmpeg_source,
    );
    let ffmpeg_program_for_log = ffmpeg_path.clone();
    log_external_command(inner, job_id, &ffmpeg_program_for_log, &args);
    let mut child = cmd
        .args(&args)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg for {}", input_path.display()))?;

    assign_child_to_job(child.id());

    let mut child_stdin = child.stdin.take();
    let mut wait_requested = false;
    let mut last_effective_elapsed_seconds: Option<f64> = None;
    let mut pause_debug = PauseLatencyDebug::default();
    let mut stderr_pump = FfmpegStderrPump::spawn(&mut child);
    let poll = Duration::from_millis(50);

    #[derive(Debug, Clone, Copy, Default)]
    struct PendingProgress {
        elapsed_seconds: Option<f64>,
        speed: Option<f64>,
        frame: Option<u64>,
    }

    let mut pending_progress = PendingProgress::default();

    let mut handle_ffmpeg_line = |line: &str, wait_requested: bool| {
        // When ffprobe is unavailable or fails, infer total duration from
        // ffmpeg's own metadata header line ("Duration: HH:MM:SS.xx,...").
        if total_duration.is_none()
            && let Some(d) = parse_ffmpeg_duration_from_metadata_line(line)
            && d > 0.0
        {
            total_duration = Some(d);
            let mut state = inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id) {
                if let Some(info) = job.media_info.as_mut() {
                    info.duration_seconds = Some(d);
                } else {
                    job.media_info = Some(MediaInfo {
                        duration_seconds: Some(d),
                        width: None,
                        height: None,
                        frame_rate: None,
                        video_codec: None,
                        audio_codec: None,
                        size_mb: None,
                    });
                }
                let key = job.filename.clone();
                if let Some(info) = job.media_info.clone() {
                    state.media_info_cache.insert(key, info);
                }
            }
        }

        let sample = parse_ffmpeg_progress_sample(line);
        if let Some(v) = sample.elapsed_seconds {
            pending_progress.elapsed_seconds = Some(v);
        }
        if let Some(v) = sample.speed {
            pending_progress.speed = Some(v);
        }
        if let Some(v) = sample.frame {
            pending_progress.frame = Some(v);
        }

        let trimmed = line.trim_start();
        if trimmed.starts_with("progress=") {
            let speed = pending_progress.speed;
            let frame = pending_progress.frame;
            if let Some(elapsed) = pending_progress.elapsed_seconds {
                if let Some(total) = total_duration
                    && elapsed.is_finite()
                    && total.is_finite()
                    && elapsed > total * 1.01
                {
                    total_duration = Some(elapsed);
                    let mut state = inner.state.lock_unpoisoned();
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        if let Some(info) = job.media_info.as_mut() {
                            info.duration_seconds = Some(elapsed);
                        } else {
                            job.media_info = Some(MediaInfo {
                                duration_seconds: Some(elapsed),
                                width: None,
                                height: None,
                                frame_rate: None,
                                video_codec: None,
                                audio_codec: None,
                                size_mb: None,
                            });
                        }
                        let key = job.filename.clone();
                        if let Some(info) = job.media_info.clone() {
                            state.media_info_cache.insert(key, info);
                        }
                    }
                }

                let effective_elapsed =
                    resume_target_seconds.map_or(elapsed, |base| base + elapsed);
                if elapsed.is_finite()
                    && elapsed > 0.0
                    && effective_elapsed.is_finite()
                    && last_effective_elapsed_seconds
                        .is_none_or(|last| effective_elapsed > last + 0.000_001)
                {
                    last_effective_elapsed_seconds = Some(effective_elapsed);
                }

                if wait_requested {
                    update_job_progress(
                        inner,
                        job_id,
                        None,
                        Some(effective_elapsed),
                        frame,
                        Some(line),
                        speed,
                    );
                } else {
                    let percent = compute_progress_percent(total_duration, effective_elapsed);
                    update_job_progress(
                        inner,
                        job_id,
                        Some(percent),
                        Some(effective_elapsed),
                        frame,
                        Some(line),
                        speed,
                    );
                }
            } else {
                update_job_progress(inner, job_id, None, None, frame, Some(line), speed);
            }

            if !wait_requested && is_ffmpeg_progress_end(line) {
                update_job_progress(
                    inner,
                    job_id,
                    Some(compute_progress_percent(
                        total_duration,
                        last_effective_elapsed_seconds.unwrap_or(0.0),
                    )),
                    last_effective_elapsed_seconds,
                    None,
                    Some(line),
                    None,
                );
            }

            pending_progress = PendingProgress::default();
            return;
        }

        // Non-progress marker lines: keep recording useful logs, but avoid
        // streaming high-frequency noise as separate state updates.
        if parse_ffmpeg_progress_line(line).is_none() && sample.elapsed_seconds.is_none() {
            update_job_progress(inner, job_id, None, None, None, Some(line), None);
        }
    };

    let status = loop {
        if is_job_cancelled(inner, job_id) {
            if let Some(sidecar) = audio_sidecar.take() {
                sidecar.kill_and_cleanup();
            }
            drop(child.kill());
            drop(child.wait());
            stderr_pump.join();
            mark_job_cancelled(inner, job_id)?;
            drop(fs::remove_file(&tmp_output));
            if two_pass_requested {
                cleanup_two_pass_outputs(&two_pass_log_output, &tmp_output, &existing_segments);
            }
            return Ok(());
        }

        if !wait_requested && is_job_wait_requested(inner, job_id) {
            pause_debug.mark_wait_seen(current_time_millis());
            send_ffmpeg_quit(&mut child_stdin);
            if let Some(sidecar) = audio_sidecar.as_mut() {
                sidecar.request_quit();
            }
            pause_debug.mark_q_sent(current_time_millis());
            wait_requested = true;
        }

        if let Some(sidecar) = audio_sidecar.as_mut() {
            sidecar.drain_available();
            if sidecar.status.is_none()
                && let Some(status) = sidecar.child.try_wait()?
            {
                sidecar.status = Some(status);
                sidecar.drain_available();
            }
        }

        if let Some(line) = stderr_pump.recv_timeout(poll) {
            handle_ffmpeg_line(&line, wait_requested);
        }

        if let Some(status) = child.try_wait()? {
            pause_debug.mark_child_exit(current_time_millis());
            stderr_pump.drain_exit_bound_lines(|line| handle_ffmpeg_line(&line, wait_requested));
            break status;
        }
    };

    if is_job_cancelled(inner, job_id) {
        if let Some(sidecar) = audio_sidecar.take() {
            sidecar.kill_and_cleanup();
        }
        mark_job_cancelled(inner, job_id)?;
        drop(fs::remove_file(&tmp_output));
        if two_pass_requested {
            cleanup_two_pass_outputs(&two_pass_log_output, &tmp_output, &existing_segments);
        }
        return Ok(());
    }

    if wait_requested {
        if let Some(sidecar) = audio_sidecar.take() {
            sidecar.kill_and_cleanup();
        }
        // The ffmpeg "quit current segment" request (`q\n`) is irreversible once
        // sent. Users can still click "Resume" before ffmpeg exits; in that
        // case we must NOT leave the job stuck in Paused state. Instead, we
        // treat the current run as a paused segment, persist wait metadata,
        // then immediately re-queue the job for continuation.
        let pause_still_requested = is_job_wait_requested(inner, job_id);

        // 暂停：尽快把状态切到 Paused，因此这里不再做任何 ffprobe 探测（它在 Windows
        // 上通常要几百毫秒到 1s）。续转边界使用 ffmpeg `-progress out_time*` 的最后值：
        // - 若该值在某些编码器/B 帧情况下略偏小，只会造成更大的 overlap（安全）；
        // - 若存在 overshoot 风险，会在“继续/完成”路径进行一次保守校准。
        let processed_seconds_override = choose_processed_seconds_after_wait(
            total_duration,
            last_effective_elapsed_seconds,
            None,
        );

        // Pause should complete quickly: defer segment remuxing to resume/finalize.
        if resume_plan.is_some() && finalize_with_source_audio {
            mark_segment_noaudio_done(tmp_output.as_path());
        }

        pause_debug.mark_mark_waiting_start(current_time_millis());
        mark_job_waiting(
            inner,
            job_id,
            &tmp_output,
            &output_path,
            total_duration,
            processed_seconds_override,
        )?;
        pause_debug.mark_mark_waiting_end(current_time_millis());
        pause_debug.emit_pause_summary(inner, job_id);

        if !pause_still_requested {
            requeue_job_after_cancelled_wait(inner, job_id);
        }
        return Ok(());
    }

    if !status.success() {
        if let Some(sidecar) = audio_sidecar.take() {
            sidecar.kill_and_cleanup();
        }
        mark_ffmpeg_status_failed(inner, job_id, status);
        // Keep partial segments on disk for recovery when this is a resumed
        // job (existing segments present). Removing the latest segment here
        // can turn a recoverable failure into irreversible content loss.
        if existing_segments.is_empty() {
            drop(fs::remove_file(&tmp_output));
        }
        if two_pass_requested {
            cleanup_two_pass_outputs_after_failed_encode(
                &two_pass_log_output,
                &tmp_output,
                !existing_segments.is_empty(),
            );
        }
        mark_batch_compress_child_processed(inner, job_id);
        return Ok(());
    }

    let elapsed = elapsed_since_execution_start(execution_start_time);

    let final_output_size_bytes: u64;

    if existing_segments.is_empty() {
        let new_size_bytes = fs::metadata(&tmp_output).map(|m| m.len()).unwrap_or(0);

        fs::rename(&tmp_output, &output_path).with_context(|| {
            format!(
                "failed to rename {} -> {}",
                tmp_output.display(),
                output_path.display()
            )
        })?;

        final_output_size_bytes = new_size_bytes;
    } else {
        // When resuming with audio mux-from-source, the current tmp output is
        // expected to be video-only (we inject `-map -0:a`). Mark it so the
        // finalize step can skip a redundant remux pass.
        if resume_plan.is_some() && finalize_with_source_audio {
            mark_segment_noaudio_done(tmp_output.as_path());
        }
        let mut all_segments = existing_segments;
        all_segments.push(tmp_output.clone());

        let segment_durations =
            derive_resume_concat_segment_durations(&segment_end_targets, all_segments.len());

        let result = finalize_resumed_job_output(FinalizeResumedJobOutputArgs {
            inner,
            job_id,
            ffmpeg_path: &ffmpeg_path,
            input_path: &input_path,
            output_path: &output_path,
            finalize_preset: &finalize_preset,
            all_segments: &all_segments,
            segment_durations: segment_durations.as_deref(),
            tmp_output: tmp_output.as_path(),
            finalize_with_source_audio,
            audio_sidecar,
        });
        match result {
            Ok(size) => {
                final_output_size_bytes = size;
            }
            Err(err) => {
                {
                    let mut state = inner.state.lock_unpoisoned();
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        job.status = JobStatus::Failed;
                        job.progress = 100.0;
                        job.end_time = Some(current_time_millis());
                        let reason =
                            format!("finalize failed when resuming from partial output: {err:#}");
                        job.failure_reason = Some(reason.clone());
                        super::worker_utils::append_job_log_line(job, reason);
                    }
                }
                // Keep partial segments for recovery on finalize errors.
                mark_batch_compress_child_processed(inner, job_id);
                return Ok(());
            }
        }
    }

    if two_pass_requested {
        cleanup_two_pass_outputs(
            &two_pass_log_output,
            &tmp_output,
            &two_pass_completed_segments,
        );
    }
    finalize_successful_transcode_job(
        inner,
        FinalizeSuccessfulTranscodeJobArgs {
            job_id,
            preset_id: &preset_id,
            output_path: &output_path,
            original_size_bytes,
            final_output_size_bytes,
            elapsed,
            input_times,
        },
    )
}

include!("job_runner_process_execute_success_finalize.rs");
