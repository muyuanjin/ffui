fn execute_transcode_job(
    inner: &Inner,
    job_id: &str,
    prepared: PreparedTranscodeJob,
) -> Result<()> {
    let PreparedTranscodeJob {
        input_path,
        settings_snapshot,
        preset,
        original_size_bytes,
        preset_id,
        output_path,
        resume_from_seconds,
        existing_segment,
        tmp_output,
        mut total_duration,
        ffmpeg_path,
        ffmpeg_source,
    } = prepared;

    let mut args = build_ffmpeg_args(&preset, &input_path, &tmp_output);

    let mut cmd = Command::new(&ffmpeg_path);
    configure_background_command(&mut cmd);
    // Increase structured progress update frequency for the bundled ffmpeg
    // binary so `job.progress` has a higher reporting rate without inventing
    // synthetic percentages. Old custom ffmpeg builds may not support this
    // flag, so we only apply it for the known static download source.
    if ffmpeg_source == "download" {
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

    // Record the exact ffmpeg command we are about to run so that users can
    // see and reproduce it from the queue UI if anything goes wrong.
    let ffmpeg_program_for_log = ffmpeg_path.clone();
    log_external_command(inner, job_id, &ffmpeg_program_for_log, &args);
    let mut child = cmd
        .args(&args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg for {}", input_path.display()))?;

    let start_time = SystemTime::now();

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            // Cooperative wait/cancel handling: if the frontend has requested
            // a wait or cancel for this job, terminate the ffmpeg child
            // process and transition the job into the appropriate state.
            if is_job_wait_requested(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_waiting(inner, job_id, &tmp_output, &output_path, total_duration)?;
                return Ok(());
            }

            if is_job_cancelled(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_cancelled(inner, job_id)?;
                let _ = fs::remove_file(&tmp_output);
                return Ok(());
            }

            if is_job_cancelled(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_cancelled(inner, job_id)?;
                let _ = fs::remove_file(&tmp_output);
                return Ok(());
            }

            // When ffprobe is unavailable or fails, infer total duration from
            // ffmpeg's own metadata header line ("Duration: HH:MM:SS.xx,...")
            // so that the UI progress bar still advances instead of staying
            // stuck at 0% until completion.
            if total_duration.is_none()
                && let Some(d) = parse_ffmpeg_duration_from_metadata_line(&line)
                && d > 0.0
            {
                total_duration = Some(d);

                // Also update the job's cached media info so future queue_state
                // snapshots and the inspection UI can see an accurate duration
                // value.
                let mut state = inner.state.lock().expect("engine state poisoned");
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
                drop(state);
            }

            if let Some((elapsed, speed)) = parse_ffmpeg_progress_line(&line) {
                // If ffmpeg reports an elapsed time that is slightly longer than
                // our current duration estimate, treat this as the new effective
                // duration. This keeps the progress bar moving smoothly instead
                // of stalling near the end when ffprobe underestimates length.
                if let Some(total) = total_duration
                    && elapsed.is_finite()
                    && total.is_finite()
                    && elapsed > total * 1.01
                {
                    total_duration = Some(elapsed);

                    // Also update the job's cached media info so future
                    // queue_state snapshots and the inspection UI can see
                    // the refined duration value.
                    let mut state = inner.state.lock().expect("engine state poisoned");
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
                    drop(state);
                }

                let effective_elapsed = if let Some(base) = resume_from_seconds {
                    base + elapsed
                } else {
                    elapsed
                };

                let mut percent = compute_progress_percent(total_duration, effective_elapsed);
                if percent >= 100.0 {
                    // Keep a tiny numerical headroom so that the last step to
                    // an exact 100% always comes from the terminal state
                    // transition (Completed / Failed / Skipped) or an explicit
                    // progress=end marker from ffmpeg, never from an in-flight
                    // stderr sample.
                    percent = 99.9;
                }

                update_job_progress(inner, job_id, Some(percent), Some(&line), speed);
            } else {
                // Non-progress lines are still useful as logs for debugging.
                update_job_progress(inner, job_id, None, Some(&line), None);
            }

            // When `-progress pipe:2` is enabled, ffmpeg emits structured
            // key=value pairs including a `progress=...` marker. Surfacing a
            // final 100% update as soon as we see `progress=end` makes the UI
            // feel truly real-time, while still keeping "100%" reserved for
            // the moment ffmpeg itself declares that all work is done.
            if is_ffmpeg_progress_end(&line) {
                update_job_progress(inner, job_id, Some(100.0), Some(&line), None);
            }
        }
    }

    let status = child.wait()?;

    if is_job_cancelled(inner, job_id) {
        mark_job_cancelled(inner, job_id)?;
        let _ = fs::remove_file(&tmp_output);
        return Ok(());
    }

    if !status.success() {
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Failed;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                let code_desc = match status.code() {
                    Some(code) => format!("exit code {code}"),
                    None => "terminated by signal".to_string(),
                };
                let reason = format!("ffmpeg exited with non-zero status ({code_desc})");
                job.failure_reason = Some(reason.clone());
                job.logs.push(reason);
                recompute_log_tail(job);
            }
        }
        let _ = fs::remove_file(&tmp_output);
        mark_smart_scan_child_processed(inner, job_id);
        return Ok(());
    }

    let elapsed = start_time
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs_f64();

    let final_output_size_bytes: u64;

    if let Some(existing) = existing_segment {
        // Resumed job: concat the previous partial segment with the new
        // segment produced in this run into a temporary target, then atomically
        // move it into place. This avoids corrupting the previous partial when
        // concat fails.
        let ext = output_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4");
        let concat_tmp = output_path.with_extension(format!("concat.tmp.{ext}"));

        if let Err(err) = concat_video_segments(&ffmpeg_path, &existing, &tmp_output, &concat_tmp) {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason =
                        format!("ffmpeg concat failed when resuming from partial output: {err:#}");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            let _ = fs::remove_file(&tmp_output);
            mark_smart_scan_child_processed(inner, job_id);
            return Ok(());
        }

        if let Err(err) = fs::rename(&concat_tmp, &output_path) {
            let _ = fs::remove_file(&concat_tmp);
            return Err(err).with_context(|| {
                format!(
                    "failed to finalize resumed output {} -> {}",
                    concat_tmp.display(),
                    output_path.display()
                )
            });
        }

        let _ = fs::remove_file(&existing);
        let _ = fs::remove_file(&tmp_output);

        final_output_size_bytes = fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
    } else {
        let new_size_bytes = fs::metadata(&tmp_output).map(|m| m.len()).unwrap_or(0);

        fs::rename(&tmp_output, &output_path).with_context(|| {
            format!(
                "failed to rename {} -> {}",
                tmp_output.display(),
                output_path.display()
            )
        })?;

        final_output_size_bytes = new_size_bytes;
    }

    // 记录所有成功生成的视频输出路径,供 Smart Scan 在后续批次中进行去重与跳过。
    register_known_smart_scan_output_with_inner(inner, &output_path);

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Completed;
            job.progress = 100.0;
            job.end_time = Some(current_time_millis());
            if original_size_bytes > 0 && final_output_size_bytes > 0 {
                job.output_size_mb = Some(final_output_size_bytes as f64 / (1024.0 * 1024.0));
            }
            job.wait_metadata = None;
            job.logs.push(format!(
                "Completed in {:.1}s, output size {:.2} MB",
                elapsed,
                job.output_size_mb.unwrap_or(0.0)
            ));
            recompute_log_tail(job);
        }

        // Update preset statistics for completed jobs.
        if original_size_bytes > 0 && final_output_size_bytes > 0 && elapsed > 0.0 {
            let input_mb = original_size_bytes as f64 / (1024.0 * 1024.0);
            let output_mb = final_output_size_bytes as f64 / (1024.0 * 1024.0);
            if let Some(preset) = state.presets.iter_mut().find(|p| p.id == preset_id) {
                preset.stats.usage_count += 1;
                preset.stats.total_input_size_mb += input_mb;
                preset.stats.total_output_size_mb += output_mb;
                preset.stats.total_time_seconds += elapsed;
            }
            // Persist updated presets.
            let _ = crate::ffui_core::settings::save_presets(&state.presets);
        }
    }

    mark_smart_scan_child_processed(inner, job_id);

    Ok(())
}
