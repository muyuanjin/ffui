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
        existing_segments,
        tmp_output,
        mut total_duration,
        ffmpeg_path,
        ffmpeg_source,
    } = prepared;

    // 队列转码任务需要支持“暂停 / 继续”，后端会通过 stdin 写入控制指令
    //（例如 `q\n`）来让 ffmpeg 优雅结束当前分段，因此这里显式关闭
    // `non_interactive`，避免自动注入 `-nostdin`。
    let job_output_policy = {
        let state = inner.state.lock().expect("engine state poisoned");
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
    let mut args = build_ffmpeg_args(
        &preset,
        &input_path,
        &tmp_output,
        false,
        job_output_policy.as_ref(),
    );

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
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg for {}", input_path.display()))?;

    // 将 ffmpeg 子进程添加到 Job Object，确保父进程退出时子进程也会被终止
    // 这对于用户强制关闭 FFUI 的场景尤为重要
    assign_child_to_job(child.id());

    let start_time = SystemTime::now();

    // 保留对子进程 stdin 的可选句柄，用于在“暂停”时写入 `q\n` 请求 ffmpeg
    // 优雅退出当前分段。这样生成的临时输出文件结构完整，便于后续多段 concat。
    let mut child_stdin = child.stdin.take();
    let mut wait_requested = false;
    let mut last_effective_elapsed_seconds: Option<f64> = None;

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
            if is_job_cancelled(inner, job_id) {
                let _ = child.kill();
                let _ = child.wait();
                mark_job_cancelled(inner, job_id)?;
                let _ = fs::remove_file(&tmp_output);
                return Ok(());
            }

            if !wait_requested && is_job_wait_requested(inner, job_id) {
                // 暂停请求：通过 stdin 写入 `q\n`，请求 ffmpeg 优雅退出当前分段。
                // 关键点：不要立刻 mark_job_waiting 并 return。必须继续 drain
                // stderr，直到 ffmpeg 退出并输出最后一批 `-progress pipe:2`
                // 行（尤其是 out_time_ms / progress=end），否则 processed_seconds
                // 可能滞后，导致下一次 resume 的 -ss 偏小并产生段落重叠。
                if let Some(mut stdin) = child_stdin.take() {
                    use std::io::Write as IoWrite;
                    let _ = stdin.write_all(b"q\n");
                    let _ = stdin.flush();
                }
                wait_requested = true;
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
                if effective_elapsed.is_finite() && effective_elapsed > 0.0 {
                    last_effective_elapsed_seconds = Some(effective_elapsed);
                }

                if wait_requested {
                    // Once a cooperative wait has been requested, freeze the
                    // user-visible progress at its current value. We still
                    // drain stderr so we can capture the final out_time sample
                    // for accurate resume seeking, but we must not advance the
                    // progress bar (especially to 100%) or resume would appear
                    // stuck due to monotonic progress semantics.
                    update_job_progress(inner, job_id, None, Some(&line), speed);
                } else {
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
                }
            } else {
                // Non-progress lines are still useful as logs for debugging.
                update_job_progress(inner, job_id, None, Some(&line), None);
            }

            // When `-progress pipe:2` is enabled, ffmpeg emits structured
            // key=value pairs including a `progress=...` marker. Surfacing a
            // final 100% update as soon as we see `progress=end` makes the UI
            // feel truly real-time, while still keeping "100%" reserved for
            // the moment ffmpeg itself declares that all work is done.
            if !wait_requested && is_ffmpeg_progress_end(&line) {
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

    if wait_requested {
        // 暂停：将当前 tmp_output 视为已完成分段，并用 ffprobe 探测分段真实 duration（端点）
        // 校准 processedSeconds（ffmpeg `-progress out_time*` 在 B 帧场景会落后，易导致续转重叠）。
        let base_by_probe =
            existing_segments
                .iter()
                .map(|p| probe_segment_duration_seconds(p.as_path(), &settings_snapshot))
                .collect::<Option<Vec<f64>>>()
                .map(|durations| durations.into_iter().sum::<f64>());

        let base = base_by_probe
            .or(resume_from_seconds)
            .unwrap_or(0.0)
            .max(0.0);

        let segment_duration = probe_segment_duration_seconds(tmp_output.as_path(), &settings_snapshot);
        let probed_end = segment_duration.map(|d| base + d);

        let processed_seconds_override =
            choose_processed_seconds_after_wait(total_duration, last_effective_elapsed_seconds, probed_end);

        mark_job_waiting(
            inner,
            job_id,
            &tmp_output,
            &output_path,
            total_duration,
            processed_seconds_override,
        )?;
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

    if !existing_segments.is_empty() {
        // Resumed job: concat all previous partial segments with the new
        // segment produced in this run into a temporary target, then atomically
        // move it into place. This avoids corrupting any existing partial when
        // concat fails。
        let ext = output_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4");
        let concat_tmp = output_path.with_extension(format!("concat.tmp.{ext}"));

        let mut all_segments = existing_segments.clone();
        all_segments.push(tmp_output.clone());

        if let Err(err) = concat_video_segments(&ffmpeg_path, &all_segments, &concat_tmp) {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
	                    let reason =
	                        format!("ffmpeg concat failed when resuming from partial output: {err:#}");
	                    job.failure_reason = Some(reason.clone());
	                    super::worker_utils::append_job_log_line(job, reason);
	                }
	            }
	            let _ = fs::remove_file(&tmp_output);
            mark_batch_compress_child_processed(inner, job_id);
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

        for seg in all_segments {
            let _ = fs::remove_file(&seg);
        }

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

    // 后续逻辑中，final_output_path 代表对用户可见的“最终输出路径”。
    // 对于非 Batch Compress 场景，它与 output_path 相同；对于启用了
    // “替换原文件”的 Batch Compress 任务，可能会在下方被更新为去掉
    // `.compressed` 后的路径（同时原文件被移入回收站）。
    let mut final_output_path = output_path.clone();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        // 先基于不可变快照计算是否需要替换原文件以及相关路径，避免在同一作用域内
        // 同时对 state 进行可变和不可变借用。
        let replace_plan: Option<(std::path::PathBuf, std::path::PathBuf)> = {
            let job_snapshot = state.jobs.get(job_id).cloned();
            if let Some(job_snapshot) = job_snapshot
                && matches!(
                    job_snapshot.source,
                    crate::ffui_core::domain::JobSource::BatchCompress
                )
                && matches!(
                    job_snapshot.job_type,
                    crate::ffui_core::domain::JobType::Video
                )
            {
                if let Some(batch_id) = job_snapshot.batch_id.clone()
                    && let Some(batch) = state.batch_compress_batches.get(&batch_id)
                    && batch.replace_original
                    && let (Some(ref input_str), Some(ref output_str)) =
                        (job_snapshot.input_path.as_ref(), job_snapshot.output_path.as_ref())
                {
                    Some((
                        std::path::PathBuf::from(input_str),
                        std::path::PathBuf::from(output_str),
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Completed;
            job.progress = 100.0;
            let now_ms = current_time_millis();
            job.end_time = Some(now_ms);
            // 最终累计耗时：优先保留 update_job_progress 已维护的 elapsed_ms（基于墙钟时间），
            // 仅在缺失时回退到 processing_started_ms/start_time 差值，避免重复累加当前段。
            if job.elapsed_ms.is_none()
                && let Some(start) = job.processing_started_ms.or(job.start_time)
                && now_ms > start
            {
                job.elapsed_ms = Some(now_ms.saturating_sub(start));
            }
            if original_size_bytes > 0 && final_output_size_bytes > 0 {
                job.output_size_mb = Some(final_output_size_bytes as f64 / (1024.0 * 1024.0));
            }
            job.wait_metadata = None;

            if let Some((input_path_buf, output_path_buf)) = replace_plan {
                apply_replace_original_video_output(
                    job,
                    &input_path_buf,
                    &output_path_buf,
                    &mut final_output_path,
                );
            }

            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "Completed in {:.1}s, output size {:.2} MB",
                    elapsed,
                    job.output_size_mb.unwrap_or(0.0)
                ),
            );
        }
        // Update preset statistics for completed jobs.
        if original_size_bytes > 0 && final_output_size_bytes > 0 && elapsed > 0.0 {
            let input_mb = original_size_bytes as f64 / (1024.0 * 1024.0);
            let output_mb = final_output_size_bytes as f64 / (1024.0 * 1024.0);
            let presets = std::sync::Arc::make_mut(&mut state.presets);
            if let Some(preset) = presets.iter_mut().find(|p| p.id == preset_id) {
                preset.stats.usage_count += 1;
                preset.stats.total_input_size_mb += input_mb;
                preset.stats.total_output_size_mb += output_mb;
                preset.stats.total_time_seconds += elapsed;
            }
            // Persist updated presets.
            let _ = crate::ffui_core::settings::save_presets(presets);
        }
    }
    if preserve_times_policy.any()
        && let Some(times) = input_times.as_ref()
        && let Err(err) = super::file_times::apply_file_times(&final_output_path, times)
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "preserve file times: failed to apply timestamps to {}: {err}",
                    final_output_path.display()
                ),
            );
        }
    }

    // 记录所有成功生成的最终输出路径,供 Batch Compress 在后续批次中进行去重与跳过。
    register_known_batch_compress_output_with_inner(inner, &final_output_path);

    mark_batch_compress_child_processed(inner, job_id);

    Ok(())
}
