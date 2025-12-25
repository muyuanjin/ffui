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

    // 队列转码任务需要支持“暂停 / 继续”，后端会通过 stdin 写入控制指令
    //（例如 `q\n`）来让 ffmpeg 优雅结束当前分段，因此这里显式关闭
    // `non_interactive`，避免自动注入 `-nostdin`。
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
    let input_times = if preserve_times_policy.any() {
        let mut times = super::file_times::read_file_times(&input_path);
        if !preserve_times_policy.created() {
            times.created = None;
        }
        if !preserve_times_policy.modified() {
            times.modified = None;
        }
        if !preserve_times_policy.accessed() {
            times.accessed = None;
        }
        Some(times)
    } else {
        None
    };
    log_resume_plan_and_normalize_segments(
        inner,
        job_id,
        &ffmpeg_path,
        resume_plan.as_ref(),
        finalize_with_source_audio,
        &existing_segments,
    );
    let mut args = build_ffmpeg_args(
        &preset,
        &input_path,
        &tmp_output,
        false,
        job_output_policy.as_ref(),
    );
    maybe_insert_copyts_for_overlap_trim(&mut args, resume_plan);
    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    maybe_inject_stats_period_for_download(&mut cmd, &mut args, &settings_snapshot, &ffmpeg_source);
    // Record the exact ffmpeg command we are about to run so that users can
    // see and reproduce it from the queue UI if anything goes wrong.
    let ffmpeg_program_for_log = ffmpeg_path.clone();
    log_external_command(inner, job_id, &ffmpeg_program_for_log, &args);
    let mut child = cmd
        .args(&args)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg for {}", input_path.display()))?;

    // 将 ffmpeg 子进程添加到 Job Object，确保父进程退出时子进程也会被终止
    // 这对于用户强制关闭 FFUI 的场景尤为重要
    assign_child_to_job(child.id());

    let start_time = SystemTime::now();

    // 保留对子进程 stdin 的可选句柄，用于在“暂停”时写入 `q\n` 请求 ffmpeg 优雅退出。
    let mut child_stdin = child.stdin.take();
    let mut wait_requested = false;
    let mut last_effective_elapsed_seconds: Option<f64> = None;
    let mut pause_debug = PauseLatencyDebug::default();
    let mut stderr_pump = FfmpegStderrPump::spawn(&mut child);
    let poll = Duration::from_millis(50);

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

        if let Some((elapsed, speed)) = parse_ffmpeg_progress_line(line) {
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

            let effective_elapsed = resume_target_seconds.map_or(elapsed, |base| base + elapsed);
            if effective_elapsed.is_finite() && effective_elapsed > 0.0 {
                last_effective_elapsed_seconds = Some(effective_elapsed);
            }

            if wait_requested {
                update_job_progress(inner, job_id, None, Some(line), speed);
            } else {
                let mut percent = compute_progress_percent(total_duration, effective_elapsed);
                if percent >= 100.0 {
                    percent = 99.9;
                }
                update_job_progress(inner, job_id, Some(percent), Some(line), speed);
            }
        } else {
            update_job_progress(inner, job_id, None, Some(line), None);
        }

        if !wait_requested && is_ffmpeg_progress_end(line) {
            update_job_progress(inner, job_id, Some(100.0), Some(line), None);
        }
    };

    let status = loop {
        if is_job_cancelled(inner, job_id) {
            let _ = child.kill();
            let _ = child.wait();
            stderr_pump.join();
            mark_job_cancelled(inner, job_id)?;
            let _ = fs::remove_file(&tmp_output);
            return Ok(());
        }

        if !wait_requested && is_job_wait_requested(inner, job_id) {
            pause_debug.mark_wait_seen(current_time_millis());
            send_ffmpeg_quit(&mut child_stdin);
            pause_debug.mark_q_sent(current_time_millis());
            wait_requested = true;
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
        mark_job_cancelled(inner, job_id)?;
        let _ = fs::remove_file(&tmp_output);
        return Ok(());
    }

    if wait_requested {
        // 暂停：尽快把状态切到 Paused，因此这里不再做任何 ffprobe 探测（它在 Windows
        // 上通常要几百毫秒到 1s）。续转边界使用 ffmpeg `-progress out_time*` 的最后值：
        // - 若该值在某些编码器/B 帧情况下略偏小，只会造成更大的 overlap（安全）；
        // - 若存在 overshoot 风险，会在“继续/完成”路径进行一次保守校准。
        let processed_seconds_override =
            choose_processed_seconds_after_wait(total_duration, last_effective_elapsed_seconds, None);

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
        return Ok(());
    }

    if !status.success() {
        {
            let mut state = inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Failed;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
	                let code_desc = status.code().map_or_else(
	                    || "terminated by signal".to_string(),
	                    |code| format!("exit code {code}"),
	                );
	                let reason = format!("ffmpeg exited with non-zero status ({code_desc})");
	                job.failure_reason = Some(reason.clone());
	                super::worker_utils::append_job_log_line(job, reason);
	            }
	        }
	        let _ = fs::remove_file(&tmp_output);
        mark_batch_compress_child_processed(inner, job_id);
        return Ok(());
    }

    let elapsed = start_time
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs_f64();

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
                        let reason = format!(
                            "finalize failed when resuming from partial output: {err:#}"
                        );
                        job.failure_reason = Some(reason.clone());
                        super::worker_utils::append_job_log_line(job, reason);
                    }
                }
                let _ = fs::remove_file(&tmp_output);
                mark_batch_compress_child_processed(inner, job_id);
                return Ok(());
            }
        }
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
