fn push_resumed_ffmpeg_common_prefix(args: &mut Vec<String>, preset: &FFmpegPreset) {
    args.push("-y".to_string());
    args.push("-nostdin".to_string());

    if let Some(global) = preset.global.as_ref() {
        if let Some(level) = &global.log_level
            && !level.is_empty()
        {
            args.push("-loglevel".to_string());
            args.push(level.clone());
        }
        if global.hide_banner.unwrap_or(false) {
            args.push("-hide_banner".to_string());
        }
    }
}

fn push_resumed_mux_inputs_and_maps(
    args: &mut Vec<String>,
    joined_video: &Path,
    audio_input: &Path,
    preset: &FFmpegPreset,
) -> bool {
    args.push("-i".to_string());
    args.push(joined_video.to_string_lossy().into_owned());
    args.push("-i".to_string());
    args.push(audio_input.to_string_lossy().into_owned());

    args.push("-map".to_string());
    args.push("0:v:0".to_string());

    let keep_subtitles = matches!(
        preset
            .subtitles
            .as_ref()
            .and_then(|s| s.strategy.as_ref()),
        Some(crate::ffui_core::domain::SubtitleStrategy::Keep)
    );
    if keep_subtitles {
        args.push("-map".to_string());
        args.push("0:s?".to_string());
    }

    args.push("-map".to_string());
    args.push("1:a?".to_string());
    keep_subtitles
}

pub(super) fn build_mux_args_for_resumed_output_with_processed_audio(
    joined_video: &Path,
    processed_audio: &Path,
    mux_tmp: &Path,
    preset: &FFmpegPreset,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    push_resumed_ffmpeg_common_prefix(&mut args, preset);
    let keep_subtitles =
        push_resumed_mux_inputs_and_maps(&mut args, joined_video, processed_audio, preset);

    args.push("-c:v".to_string());
    args.push("copy".to_string());
    args.push("-c:a".to_string());
    args.push("copy".to_string());

    if keep_subtitles {
        args.push("-c:s".to_string());
        args.push("copy".to_string());
    }

    apply_mapping_disposition_and_metadata_args(&mut args, preset);
    apply_container_args(&mut args, preset, None);

    args.push("-shortest".to_string());
    args.push(mux_tmp.to_string_lossy().into_owned());
    ensure_progress_args(&mut args);
    args
}

pub(super) fn build_audio_sidecar_args_for_resumed_output(
    input_path: &Path,
    audio_tmp: &Path,
    preset: &FFmpegPreset,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    push_resumed_ffmpeg_common_prefix(&mut args, preset);

    args.push("-i".to_string());
    args.push(input_path.to_string_lossy().into_owned());
    args.push("-map".to_string());
    args.push("0:a?".to_string());
    args.push("-vn".to_string());
    apply_audio_args(&mut args, preset);
    apply_audio_filter_args(&mut args, preset);
    args.push(audio_tmp.to_string_lossy().into_owned());
    ensure_progress_args(&mut args);
    args
}

struct AudioFinalizationSidecar {
    child: std::process::Child,
    child_stdin: Option<std::process::ChildStdin>,
    stderr_pump: FfmpegStderrPump,
    tmp_path: PathBuf,
    last_sample: AudioSidecarProgressSample,
    status: Option<std::process::ExitStatus>,
}

#[derive(Clone, Copy, Default)]
struct AudioSidecarProgressSample {
    elapsed_seconds: Option<f64>,
    speed: Option<f64>,
    frame: Option<u64>,
}

impl AudioFinalizationSidecar {
    fn drain_available(&mut self) {
        let sample = &mut self.last_sample;
        self.stderr_pump.drain_available(|line| {
            let parsed = parse_ffmpeg_progress_sample(&line);
            if let Some(v) = parsed.elapsed_seconds {
                sample.elapsed_seconds = Some(v);
            }
            if let Some(v) = parsed.speed {
                sample.speed = Some(v);
            }
            if let Some(v) = parsed.frame {
                sample.frame = Some(v);
            }
        });
    }

    fn request_quit(&mut self) {
        send_ffmpeg_quit(&mut self.child_stdin);
    }

    fn kill_and_cleanup(mut self) {
        drop(self.child.kill());
        drop(self.child.wait());
        self.stderr_pump.join();
        drop(fs::remove_file(&self.tmp_path));
    }
}

pub(super) fn should_precompute_resumed_audio(preset: &FFmpegPreset) -> bool {
    !matches!(preset.audio.codec, AudioCodecType::Copy)
}

pub(super) fn choose_audio_finalization_phase_duration(
    input_duration_seconds: Option<f64>,
    fallback_duration_seconds: Option<f64>,
) -> Option<f64> {
    input_duration_seconds
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .or_else(|| fallback_duration_seconds.filter(|duration| duration.is_finite() && *duration > 0.0))
}

fn audio_sidecar_tmp_path(output_path: &Path) -> PathBuf {
    output_path.with_extension("audio.finalizing.tmp.m4a")
}

fn start_audio_finalization_sidecar(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    input_path: &Path,
    output_path: &Path,
    preset: &FFmpegPreset,
) -> Result<AudioFinalizationSidecar> {
    let audio_tmp = audio_sidecar_tmp_path(output_path);
    drop(fs::remove_file(&audio_tmp));
    let args = build_audio_sidecar_args_for_resumed_output(input_path, &audio_tmp, preset);
    log_external_command(inner, job_id, ffmpeg_path, &args);

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let mut child = cmd
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "failed to spawn ffmpeg audio sidecar for resumed output")?;
    assign_child_to_job(child.id());
    let child_stdin = child.stdin.take();
    let stderr_pump = FfmpegStderrPump::spawn(&mut child);
    Ok(AudioFinalizationSidecar {
        child,
        child_stdin,
        stderr_pump,
        tmp_path: audio_tmp,
        last_sample: AudioSidecarProgressSample::default(),
        status: None,
    })
}

fn wait_for_audio_sidecar(
    inner: &Inner,
    job_id: &str,
    mut sidecar: AudioFinalizationSidecar,
    expected_seconds: Option<f64>,
) -> Result<Option<PathBuf>> {
    if let Some(status) = sidecar.status {
        sidecar.stderr_pump.join();
        if status.success() {
            return Ok(Some(sidecar.tmp_path));
        }
        drop(fs::remove_file(&sidecar.tmp_path));
        return Ok(None);
    }

    let input_duration_seconds = {
        let state = inner.state.lock_unpoisoned();
        state
            .jobs
            .get(job_id)
            .and_then(|job| job.media_info.as_ref())
            .and_then(|info| info.duration_seconds)
    };
    let phase_duration_seconds =
        choose_audio_finalization_phase_duration(input_duration_seconds, expected_seconds);
    set_job_progress_phase(
        inner,
        job_id,
        ProgressPhase::AudioFinalizing,
        phase_duration_seconds,
    );
    if sidecar.last_sample.elapsed_seconds.is_some()
        || sidecar.last_sample.speed.is_some()
        || sidecar.last_sample.frame.is_some()
    {
        update_job_progress(
            inner,
            job_id,
            None,
            sidecar.last_sample.elapsed_seconds,
            sidecar.last_sample.frame,
            None,
            sidecar.last_sample.speed,
        );
    }

    let poll = Duration::from_millis(100);
    loop {
        if is_job_cancelled(inner, job_id) {
            sidecar.kill_and_cleanup();
            mark_job_cancelled(inner, job_id)?;
            return Ok(None);
        }
        if is_job_wait_requested(inner, job_id) {
            sidecar.request_quit();
        }

        if let Some(line) = sidecar.stderr_pump.recv_timeout(poll) {
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
        }

        if let Some(status) = sidecar.child.try_wait()? {
            sidecar.stderr_pump.drain_exit_bound_lines(|line| {
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
            });
            if status.success() {
                return Ok(Some(sidecar.tmp_path));
            }

            drop(fs::remove_file(&sidecar.tmp_path));
            let mut state = inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id) {
                super::worker_utils::append_job_log_line(
                    job,
                    format!(
                        "resume: warning: parallel audio finalization failed (status {status}); falling back to serial final mux"
                    ),
                );
            }
            return Ok(None);
        }
    }
}
