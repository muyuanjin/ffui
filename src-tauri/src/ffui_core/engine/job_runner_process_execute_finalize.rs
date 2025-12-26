#[derive(Clone, Copy)]
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
        let mux_args =
            build_mux_args_for_resumed_output(&joined_video_tmp, input_path, &mux_tmp, finalize_preset);
        log_external_command(inner, job_id, ffmpeg_path, &mux_args);
        let mut mux_cmd = Command::new(ffmpeg_path);
        configure_background_command(&mut mux_cmd);
        let status = mux_cmd
            .args(&mux_args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .with_context(|| "failed to run ffmpeg mux for resumed output")?;
        if !status.success() {
            drop(fs::remove_file(&mux_tmp));
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
    } else {
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
    })
}

pub(super) fn build_mux_args_for_resumed_output(
    joined_video: &Path,
    input_path: &Path,
    mux_tmp: &Path,
    preset: &FFmpegPreset,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    args.push("-y".to_string());

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

    args.push("-i".to_string());
    args.push(joined_video.to_string_lossy().into_owned());
    args.push("-i".to_string());
    args.push(input_path.to_string_lossy().into_owned());

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
    args
}
