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

    if finalize_with_source_audio
        && let Err(err) = remux_segment_drop_audio(ffmpeg_path, tmp_output)
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
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
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                "resume: concat list uses explicit per-segment durations (segmentEndTargets)".to_string(),
            );
        }
    }

    concat_video_segments(ffmpeg_path, all_segments, segment_durations, &joined_video_tmp)
        .with_context(|| "ffmpeg concat failed when resuming from partial output")?;

    if finalize_with_source_audio {
        let mux_args =
            build_mux_args_for_resumed_output(&joined_video_tmp, input_path, &mux_tmp, finalize_preset);
        log_external_command(inner, job_id, ffmpeg_path, &mux_args);
        let mut mux_cmd = Command::new(ffmpeg_path);
        configure_background_command(&mut mux_cmd);
        let status = mux_cmd
            .args(&mux_args)
            .status()
            .with_context(|| "failed to run ffmpeg mux for resumed output")?;
        if !status.success() {
            let _ = fs::remove_file(&mux_tmp);
            let _ = fs::remove_file(&joined_video_tmp);
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

    let _ = fs::remove_file(&joined_video_tmp);
    for seg in all_segments {
        let _ = fs::remove_file(seg);
    }

    Ok(fs::metadata(output_path).map(|m| m.len()).unwrap_or(0))
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

    match preset.audio.codec {
        crate::ffui_core::domain::AudioCodecType::Copy => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        crate::ffui_core::domain::AudioCodecType::Aac => {
            args.push("-c:a".to_string());
            args.push("aac".to_string());
            if let Some(bitrate) = preset.audio.bitrate {
                args.push("-b:a".to_string());
                args.push(format!("{bitrate}k"));
            }
            if let Some(sample_rate) = preset.audio.sample_rate_hz {
                args.push("-ar".to_string());
                args.push(sample_rate.to_string());
            }
            if let Some(channels) = preset.audio.channels {
                args.push("-ac".to_string());
                args.push(channels.to_string());
            }
            if let Some(layout) = &preset.audio.channel_layout
                && !layout.is_empty()
            {
                args.push("-channel_layout".to_string());
                args.push(layout.clone());
            }

            let mut af_parts: Vec<String> = Vec::new();
            if let Some(ref profile) = preset.audio.loudness_profile
                && profile != "none"
            {
                let default_i = preset.audio.target_lufs.unwrap_or(if profile == "cnBroadcast" {
                    -24.0
                } else {
                    -23.0
                });
                let default_lra = preset.audio.loudness_range.unwrap_or(7.0);
                let default_tp = preset.audio.true_peak_db.unwrap_or(if profile == "cnBroadcast" {
                    -2.0
                } else {
                    -1.0
                });

                let safe_i = default_i.clamp(-36.0, -10.0);
                let safe_lra = default_lra.clamp(1.0, 20.0);
                let safe_tp = default_tp.min(-0.1);

                af_parts.push(format!(
                    "loudnorm=I={safe_i}:LRA={safe_lra}:TP={safe_tp}:print_format=summary"
                ));
            }
            if let Some(af_chain) = &preset.filters.af_chain {
                let trimmed = af_chain.trim();
                if !trimmed.is_empty() {
                    af_parts.push(trimmed.to_string());
                }
            }
            if !af_parts.is_empty() {
                args.push("-af".to_string());
                args.push(af_parts.join(","));
            }
        }
    }

    if let Some(mapping) = preset.mapping.as_ref() {
        if let Some(dispositions) = &mapping.dispositions {
            for d in dispositions {
                if !d.is_empty() {
                    args.push("-disposition".to_string());
                    args.push(d.clone());
                }
            }
        }
        if let Some(metadata) = &mapping.metadata {
            for kv in metadata {
                if !kv.is_empty() {
                    args.push("-metadata".to_string());
                    args.push(kv.clone());
                }
            }
        }
    }

    if let Some(container) = preset.container.as_ref() {
        if let Some(format) = container.format.as_ref()
            && !format.trim().is_empty()
        {
            args.push("-f".to_string());
            let normalized = normalize_container_format(format);
            if !normalized.is_empty() {
                args.push(normalized);
            }
        }
        if let Some(flags) = &container.movflags {
            let joined: String = flags
                .iter()
                .map(|f| f.trim())
                .filter(|f| !f.is_empty())
                .collect::<Vec<_>>()
                .join("+");
            if !joined.is_empty() {
                args.push("-movflags".to_string());
                args.push(joined);
            }
        }
    }

    args.push("-shortest".to_string());
    args.push(mux_tmp.to_string_lossy().into_owned());
    args
}
