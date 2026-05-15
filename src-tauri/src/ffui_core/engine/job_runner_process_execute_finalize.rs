struct FinalizeResumedJobOutputArgs<'a> {
    inner: &'a Inner,
    job_id: &'a str,
    ffmpeg_path: &'a str,
    input_path: &'a Path,
    output_path: &'a Path,
    finalize_preset: &'a FFmpegPreset,
    all_segments: &'a [PathBuf],
    segment_durations: Option<&'a [f64]>,
    tmp_output: &'a Path,
    finalize_with_source_audio: bool,
    audio_sidecar: Option<AudioFinalizationSidecar>,
}

fn finalize_resumed_job_output(args: FinalizeResumedJobOutputArgs<'_>) -> Result<u64> {
    let FinalizeResumedJobOutputArgs {
        inner,
        job_id,
        ffmpeg_path,
        input_path,
        output_path,
        finalize_preset,
        all_segments,
        segment_durations,
        tmp_output,
        finalize_with_source_audio,
        audio_sidecar,
    } = args;
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    let joined_video_tmp = output_path.with_extension(format!("video.concat.tmp.{ext}"));
    let mux_tmp = output_path.with_extension(format!("concat.tmp.{ext}"));
    let can_cleanup_segments = true;

    if finalize_with_source_audio
        && let Err(err) = remux_segment_drop_audio(ffmpeg_path, tmp_output)
    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "resume: warning: failed to remux final segment to drop audio ({}): {err:#}",
                    tmp_output.display()
                ),
            );
        }
    }

    if segment_durations.is_some() {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                "resume: concat list uses explicit per-segment durations (segmentEndTargets)".to_string(),
            );
        }
    }

    set_job_progress_phase(inner, job_id, ProgressPhase::Concatenating, None);
    concat_video_segments(ffmpeg_path, all_segments, segment_durations, &joined_video_tmp)
        .with_context(|| "ffmpeg concat failed when resuming from partial output")?;

    // Data-loss guard: if concat output is suspiciously shorter than the intended
    // resume boundary, refuse to finalize and keep all partial segments for
    // recovery. This is especially important when users rapidly toggle
    // pause/resume and segment metadata can momentarily desync.
    let (settings_snapshot, expected_from_job) = {
        let state = inner.state.lock_unpoisoned();
        let expected = state
            .jobs
            .get(job_id)
            .and_then(|job| job.wait_metadata.as_ref())
            .and_then(|meta| {
                meta.segment_end_targets
                    .as_ref()
                    .and_then(|v| v.last().copied())
                    .or(meta.target_seconds)
                    .or(meta.processed_seconds)
                    .or(meta.last_progress_out_time_seconds)
            })
            .filter(|v| v.is_finite() && *v > 0.0);
        (state.settings.clone(), expected)
    };
    let expected_from_durations = segment_durations
        .map(|d| d.iter().copied().filter(|v| v.is_finite() && *v > 0.0).sum::<f64>())
        .filter(|v| v.is_finite() && *v > 0.0);
    let expected_seconds = expected_from_durations.or(expected_from_job);

    if let Some(expected) = expected_seconds {
        match detect_duration_seconds(&joined_video_tmp, &settings_snapshot) {
            Ok(actual) => {
                let tolerance = (expected * 0.001).max(0.5);
                if actual.is_finite() && actual + tolerance < expected {
                    let mut state = inner.state.lock_unpoisoned();
                    if let Some(job) = state.jobs.get_mut(job_id) {
                        super::worker_utils::append_job_log_line(
                            job,
                            format!(
                                "resume: refusing to finalize: joined video duration {actual:.3}s is shorter than expected {expected:.3}s (tolerance {tolerance:.3}s); keeping temp segments for recovery"
                            ),
                        );
                    }
                    return Err(anyhow::anyhow!(
                        "resumed concat output duration ({actual:.3}s) shorter than expected ({expected:.3}s)"
                    ));
                }
            }
            Err(err) => {
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!(
                            "resume: warning: failed to probe joined output duration ({}): {err:#}; keeping temp segments for recovery",
                            joined_video_tmp.display()
                        ),
                    );
                }
                return Err(anyhow::anyhow!(
                    "failed to probe resumed concat output duration ({}): {err:#}",
                    joined_video_tmp.display()
                ));
            }
        }
    }

    if finalize_with_source_audio {
        let processed_audio = match audio_sidecar {
            Some(sidecar) => wait_for_audio_sidecar(inner, job_id, sidecar, expected_seconds)?,
            None => None,
        };
        set_job_progress_phase(inner, job_id, ProgressPhase::Muxing, expected_seconds);
        let mux_args = match processed_audio.as_ref() {
            Some(audio_tmp) => build_mux_args_for_resumed_output_with_processed_audio(
                &joined_video_tmp,
                audio_tmp,
                &mux_tmp,
                finalize_preset,
            ),
            None => build_mux_args_for_resumed_output(
                &joined_video_tmp,
                input_path,
                &mux_tmp,
                finalize_preset,
            ),
        };
        log_external_command(inner, job_id, ffmpeg_path, &mux_args);
        let status = run_resumed_output_mux(
            inner,
            job_id,
            ffmpeg_path,
            &mux_args,
        )
            .with_context(|| "failed to run ffmpeg mux for resumed output")?;
        if !status.success() {
            drop(fs::remove_file(&mux_tmp));
            if let Some(audio_tmp) = processed_audio.as_ref() {
                drop(fs::remove_file(audio_tmp));
            }
            return Err(anyhow::anyhow!(
                "ffmpeg mux failed when finalizing resumed output (status {status})"
            ));
        }
        fs::rename(&mux_tmp, output_path).with_context(|| {
            format!(
                "failed to finalize resumed output {} -> {}",
                mux_tmp.display(),
                output_path.display()
            )
        })?;
        if let Some(audio_tmp) = processed_audio.as_ref() {
            drop(fs::remove_file(audio_tmp));
        }
    } else {
        set_job_progress_phase(inner, job_id, ProgressPhase::Completed, None);
        fs::rename(&joined_video_tmp, output_path).with_context(|| {
            format!(
                "failed to finalize resumed output {} -> {}",
                joined_video_tmp.display(),
                output_path.display()
            )
        })?;
    }

    if can_cleanup_segments {
        drop(fs::remove_file(&joined_video_tmp));
        for seg in all_segments {
            drop(fs::remove_file(seg));
            drop(fs::remove_file(noaudio_marker_path_for_segment(seg.as_path())));
        }
    }

    Ok(fs::metadata(output_path).map(|m| m.len()).unwrap_or(0))
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn finalize_resumed_job_output_for_tests(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    input_path: &Path,
    output_path: &Path,
    finalize_preset: &FFmpegPreset,
    all_segments: &[PathBuf],
    segment_durations: Option<&[f64]>,
    tmp_output: &Path,
    finalize_with_source_audio: bool,
) -> Result<u64> {
    finalize_resumed_job_output(FinalizeResumedJobOutputArgs {
        inner,
        job_id,
        ffmpeg_path,
        input_path,
        output_path,
        finalize_preset,
        all_segments,
        segment_durations,
        tmp_output,
        finalize_with_source_audio,
        audio_sidecar: None,
    })
}

pub(super) fn build_mux_args_for_resumed_output(
    joined_video: &Path,
    input_path: &Path,
    mux_tmp: &Path,
    preset: &FFmpegPreset,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    push_resumed_ffmpeg_common_prefix(&mut args, preset);
    let keep_subtitles =
        push_resumed_mux_inputs_and_maps(&mut args, joined_video, input_path, preset);

    args.push("-c:v".to_string());
    args.push("copy".to_string());

    if keep_subtitles {
        args.push("-c:s".to_string());
        args.push("copy".to_string());
    }

    apply_audio_args(&mut args, preset);
    apply_audio_filter_args(&mut args, preset);

    apply_mapping_disposition_and_metadata_args(&mut args, preset);
    apply_container_args(&mut args, preset, None);

    args.push("-shortest".to_string());
    args.push(mux_tmp.to_string_lossy().into_owned());
    ensure_progress_args(&mut args);
    args
}

fn run_resumed_output_mux(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    mux_args: &[String],
) -> Result<std::process::ExitStatus> {
    let mut mux_cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut mux_cmd);
    let mut child = mux_cmd
        .args(mux_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "failed to spawn ffmpeg mux for resumed output")?;
    assign_child_to_job(child.id());

    let mut stderr_pump = FfmpegStderrPump::spawn(&mut child);
    let poll = Duration::from_millis(100);
    let mut last_visible_progress_log_at_ms = 0;

    let mut handle_line = |line: String| {
        let sample = parse_ffmpeg_progress_sample(&line);
        update_job_progress(
            inner,
            job_id,
            None,
            sample.elapsed_seconds,
            sample.frame,
            Some(&line),
            sample.speed,
        );

        if let Some(elapsed) = sample.elapsed_seconds {
            let now_ms = current_time_millis();
            if last_visible_progress_log_at_ms == 0
                || now_ms.saturating_sub(last_visible_progress_log_at_ms) >= 15_000
            {
                last_visible_progress_log_at_ms = now_ms;
                let suffix = sample
                    .speed
                    .map(|speed| format!(", speed {speed:.2}x"))
                    .unwrap_or_default();
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!("resume: final mux progress out_time {elapsed:.1}s{suffix}"),
                    );
                }
            }
        }
    };

    loop {
        if let Some(line) = stderr_pump.recv_timeout(poll) {
            handle_line(line);
        }

        if let Some(status) = child.try_wait()? {
            stderr_pump.drain_exit_bound_lines(&mut handle_line);
            return Ok(status);
        }
    }
}
