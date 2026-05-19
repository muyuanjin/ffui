struct TwoPassPreludeArgs<'a> {
    inner: &'a Inner,
    job_id: &'a str,
    input_path: &'a Path,
    tmp_output: &'a Path,
    output_path: &'a Path,
    preset: &'a FFmpegPreset,
    job_output_policy: Option<&'a crate::ffui_core::domain::OutputPolicy>,
    resume_plan: Option<&'a ResumePlan>,
    settings_snapshot: &'a AppSettings,
    ffmpeg_path: &'a str,
    ffmpeg_source: &'a str,
}

fn plan_initial_two_pass_second_args(ctx: TwoPassPreludeArgs<'_>) -> Result<Option<Vec<String>>> {
    let TwoPassPreludeArgs {
        inner,
        job_id,
        input_path,
        tmp_output,
        output_path,
        preset,
        job_output_policy,
        resume_plan,
        settings_snapshot,
        ffmpeg_path,
        ffmpeg_source,
    } = ctx;

    let planned_runs =
        build_ffmpeg_run_plan(preset, input_path, tmp_output, false, job_output_policy)
            .map_err(anyhow::Error::msg)?;
    let Some(pass_one) = planned_runs
        .iter()
        .find(|run| matches!(run.kind, FfmpegRunKind::TwoPassFirst))
    else {
        return Ok(None);
    };

    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                "two-pass: starting pass 1 analysis".to_string(),
            );
        }
    }
    let mut pass_one_args = pass_one.args.clone();
    maybe_insert_copyts_for_overlap_trim(&mut pass_one_args, resume_plan);
    let status = run_two_pass_first_pass(
        inner,
        job_id,
        ffmpeg_path,
        input_path,
        settings_snapshot,
        ffmpeg_source,
        pass_one_args,
        tmp_output,
    )?;
    match status {
        TwoPassFirstPassStatus::Completed => {
            reset_job_progress_for_two_pass_second_pass(inner, job_id);
            Ok(planned_runs
                .into_iter()
                .find(|run| matches!(run.kind, FfmpegRunKind::TwoPassSecond))
                .map(|run| run.args))
        }
        TwoPassFirstPassStatus::Cancelled => {
            drop(fs::remove_file(tmp_output));
            cleanup_two_pass_artifacts(tmp_output);
            Ok(None)
        }
        TwoPassFirstPassStatus::Paused => {
            handle_two_pass_first_pass_pause(
                inner,
                job_id,
                tmp_output,
                output_path,
            )?;
            Ok(None)
        }
        TwoPassFirstPassStatus::Failed(status) => {
            mark_ffmpeg_status_failed(inner, job_id, status);
            drop(fs::remove_file(tmp_output));
            cleanup_two_pass_artifacts(tmp_output);
            mark_batch_compress_child_processed(inner, job_id);
            Ok(None)
        }
    }
}

fn current_two_pass_log_output(tmp_output: &Path) -> PathBuf {
    tmp_output.to_path_buf()
}

fn rewrite_current_two_pass_log_prefix(args: &mut [String], tmp_output: &Path) -> PathBuf {
    let log_output = current_two_pass_log_output(tmp_output);
    rewrite_two_pass_log_prefix(args, &log_output);
    log_output
}

fn cleanup_two_pass_outputs(log_output: &Path, tmp_output: &Path, completed_segments: &[PathBuf]) {
    cleanup_two_pass_artifacts(log_output);
    if log_output != tmp_output {
        cleanup_two_pass_artifacts(tmp_output);
    }
    for segment in completed_segments {
        cleanup_two_pass_artifacts(segment);
    }
}

fn cleanup_two_pass_outputs_after_failed_encode(
    log_output: &Path,
    tmp_output: &Path,
    has_resumable_segments: bool,
) {
    if has_resumable_segments {
        return;
    }
    cleanup_two_pass_artifacts(log_output);
    if log_output != tmp_output {
        cleanup_two_pass_artifacts(tmp_output);
    }
}

fn cleanup_two_pass_outputs_if_requested(
    requested: bool,
    log_output: &Path,
    tmp_output: &Path,
    completed_segments: &[PathBuf],
) {
    if requested {
        cleanup_two_pass_outputs(log_output, tmp_output, completed_segments);
    }
}

fn elapsed_since_execution_start(execution_start_time: SystemTime) -> f64 {
    execution_start_time
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs_f64()
}

enum TwoPassFirstPassStatus {
    Completed,
    Failed(std::process::ExitStatus),
    Paused,
    Cancelled,
}

#[allow(clippy::too_many_arguments)]
fn run_two_pass_first_pass(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    input_path: &Path,
    settings_snapshot: &AppSettings,
    ffmpeg_source: &str,
    mut args: Vec<String>,
    tmp_output: &Path,
) -> Result<TwoPassFirstPassStatus> {
    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    maybe_inject_stats_period_for_download(
        inner,
        &mut args,
        settings_snapshot,
        ffmpeg_path,
        ffmpeg_source,
    );
    log_external_command(inner, job_id, ffmpeg_path, &args);
    let mut child = cmd
        .args(&args)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn ffmpeg pass 1 for {}", input_path.display()))?;
    assign_child_to_job(child.id());

    let mut child_stdin = child.stdin.take();
    let mut wait_requested = false;
    let mut stderr_pump = FfmpegStderrPump::spawn(&mut child);
    let poll = Duration::from_millis(50);

    let status = loop {
        if is_job_cancelled(inner, job_id) {
            drop(child.kill());
            drop(child.wait());
            stderr_pump.join();
            mark_job_cancelled(inner, job_id)?;
            drop(fs::remove_file(tmp_output));
            return Ok(TwoPassFirstPassStatus::Cancelled);
        }

        if !wait_requested && is_job_wait_requested(inner, job_id) {
            send_ffmpeg_quit(&mut child_stdin);
            wait_requested = true;
        }

        if let Some(line) = stderr_pump.recv_timeout(poll)
            && parse_ffmpeg_progress_line(&line).is_none()
        {
            update_job_progress(inner, job_id, None, None, None, Some(&line), None);
        }

        if let Some(status) = child.try_wait()? {
            stderr_pump.drain_exit_bound_lines(|line| {
                if parse_ffmpeg_progress_line(&line).is_none() {
                    update_job_progress(inner, job_id, None, None, None, Some(&line), None);
                }
            });
            break status;
        }
    };

    if is_job_cancelled(inner, job_id) {
        mark_job_cancelled(inner, job_id)?;
        drop(fs::remove_file(tmp_output));
        return Ok(TwoPassFirstPassStatus::Cancelled);
    }
    if wait_requested {
        return Ok(TwoPassFirstPassStatus::Paused);
    }
    if !status.success() {
        return Ok(TwoPassFirstPassStatus::Failed(status));
    }
    Ok(TwoPassFirstPassStatus::Completed)
}

fn mark_ffmpeg_status_failed(inner: &Inner, job_id: &str, status: std::process::ExitStatus) {
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

fn reset_job_progress_for_two_pass_second_pass(inner: &Inner, job_id: &str) {
    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.progress = 0.0;
            super::worker_utils::append_job_log_line(
                job,
                "two-pass: pass 1 complete; starting pass 2 encode".to_string(),
            );
        }
    }
    notify_queue_listeners(inner);
}

fn cleanup_two_pass_artifacts(output: &Path) {
    for path in two_pass_artifact_paths(output) {
        drop(fs::remove_file(path));
    }
}

fn mark_two_pass_first_pass_waiting_for_restart(
    inner: &Inner,
    job_id: &str,
    tmp_output: &Path,
    output_path: &Path,
) -> Result<()> {
    let tmp_str = tmp_output.to_string_lossy().into_owned();
    let output_str = output_path.to_string_lossy().into_owned();
    let now_ms = current_time_millis();

    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Paused;

            let previous_wall_ms = job
                .wait_metadata
                .as_ref()
                .and_then(|meta| meta.processed_wall_millis.or(job.elapsed_ms))
                .unwrap_or(0);
            let current_segment_ms = job
                .processing_started_ms
                .or(job.start_time)
                .map_or(0, |start| now_ms.saturating_sub(start));
            let elapsed_wall_ms = previous_wall_ms + current_segment_ms;
            job.elapsed_ms = Some(elapsed_wall_ms);

            let percent = if job.progress.is_finite() && job.progress >= 0.0 {
                Some(job.progress)
            } else {
                None
            };

            let previous_meta = job.wait_metadata.clone();
            let mut segments = previous_meta
                .as_ref()
                .and_then(|meta| meta.segments.clone())
                .unwrap_or_default();
            segments.retain(|segment| segment != &tmp_str);

            if segments.is_empty()
                && let Some(prev_tmp) = previous_meta
                    .as_ref()
                    .and_then(|meta| meta.tmp_output_path.as_ref())
                && !prev_tmp.is_empty()
                && prev_tmp != &tmp_str
            {
                segments.push(prev_tmp.clone());
            }

            let mut segment_end_targets = previous_meta
                .as_ref()
                .and_then(|meta| meta.segment_end_targets.clone())
                .unwrap_or_default();
            segment_end_targets.truncate(segments.len());
            let last_target = segment_end_targets
                .iter()
                .copied()
                .rfind(|target| target.is_finite() && *target > 0.0)
                .or_else(|| {
                    previous_meta
                        .as_ref()
                        .and_then(|meta| meta.target_seconds.or(meta.processed_seconds))
                        .filter(|target| target.is_finite() && *target > 0.0)
                });

            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: percent,
                processed_wall_millis: Some(elapsed_wall_ms),
                processed_seconds: last_target,
                target_seconds: last_target,
                progress_epoch: previous_meta.as_ref().and_then(|meta| meta.progress_epoch),
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: None,
                tmp_output_path: Some(tmp_str.clone()),
                segments: (!segments.is_empty()).then_some(segments),
                segment_end_targets: (!segment_end_targets.is_empty())
                    .then_some(segment_end_targets),
            });

            if job.output_path.is_none() {
                job.output_path = Some(output_str);
            }

            super::worker_utils::append_job_log_line(
                job,
                "two-pass: pause requested; resume will restart from pass 1".to_string(),
            );
        }

        if !state.queue.iter().any(|id| id == job_id) {
            state.queue.push_front(job_id.to_string());
        }
        state.wait_requests.remove(job_id);
        state.cancelled_jobs.remove(job_id);
    }

    notify_queue_listeners(inner);
    mark_batch_compress_child_processed(inner, job_id);
    cleanup_two_pass_artifacts(tmp_output);
    drop(fs::remove_file(tmp_output));
    Ok(())
}

fn handle_two_pass_first_pass_pause(
    inner: &Inner,
    job_id: &str,
    tmp_output: &Path,
    output_path: &Path,
) -> Result<()> {
    let pause_still_requested = is_job_wait_requested(inner, job_id);
    mark_two_pass_first_pass_waiting_for_restart(inner, job_id, tmp_output, output_path)?;
    if !pause_still_requested {
        requeue_job_after_cancelled_wait(inner, job_id);
    }
    Ok(())
}

include!("job_runner_process_execute_two_pass_tests.rs");
