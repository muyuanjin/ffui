pub(super) struct ResumePresetBuildContext<'a> {
    pub(super) inner: &'a Inner,
    pub(super) job_id: &'a str,
    pub(super) input_path: &'a Path,
    pub(super) settings_snapshot: &'a AppSettings,
    pub(super) output_path: &'a Path,
    pub(super) resume_target_seconds: &'a mut Option<f64>,
    pub(super) resume_plan: &'a mut Option<ResumePlan>,
    pub(super) existing_segments: &'a mut Vec<PathBuf>,
}

pub(super) fn build_effective_preset_for_resume(
    ctx: ResumePresetBuildContext<'_>,
    preset: &FFmpegPreset,
) -> (FFmpegPreset, FFmpegPreset, bool) {
    let ResumePresetBuildContext {
        inner,
        job_id,
        input_path,
        settings_snapshot,
        output_path,
        resume_target_seconds,
        resume_plan,
        existing_segments,
    } = ctx;
    let finalize_preset = preset.clone();
    let mut effective_preset = preset.clone();
    let mut finalize_with_source_audio = resume_plan.is_some();

    if let Some(mut plan) = *resume_plan {
        let has_template = effective_preset.advanced_enabled.unwrap_or(false)
            && effective_preset
                .ffmpeg_template
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
        let has_filter_complex = effective_preset
            .filters
            .filter_complex
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        let can_overlap_trim = !has_template
            && !has_filter_complex
            && !matches!(
                effective_preset.video.encoder,
                crate::ffui_core::domain::EncoderType::Copy
            );

        if !can_overlap_trim {
            if matches!(plan.strategy, ResumeStrategy::OverlapTrim) {
                let mut state = inner.state.lock_unpoisoned();
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        "resume: overlap+trim disabled for this preset; falling back to legacy seek"
                            .to_string(),
                    );
                }
            }
            plan.strategy = ResumeStrategy::LegacySeek;
            plan.seek_seconds = plan.target_seconds;
            plan.trim_start_seconds = 0.0;
        }

        if plan.seek_seconds > plan.target_seconds {
            plan.seek_seconds = plan.target_seconds;
            plan.trim_start_seconds = 0.0;
            plan.strategy = ResumeStrategy::LegacySeek;
        }

        *resume_plan = Some(plan);
        finalize_with_source_audio = true;
    }

    if let Some(offset) = *resume_target_seconds {
        let seek = resume_plan
            .as_ref()
            .map(|p| p.seek_seconds)
            .unwrap_or(offset);

        match effective_preset.input {
            Some(ref mut timeline) => {
                use crate::ffui_core::domain::SeekMode;
                match timeline.seek_mode {
                    None | Some(SeekMode::Input) => {
                        timeline.seek_mode = Some(SeekMode::Input);
                        timeline.seek_position = Some(format!("{seek:.6}"));
                        if timeline.accurate_seek.is_none() {
                            timeline.accurate_seek = Some(true);
                        }
                    }
                    Some(SeekMode::Output) => {
                        // Preserve caller-provided output-side seeking; disable
                        // automatic resume for such advanced timelines.
                        *resume_target_seconds = None;
                        *resume_plan = None;
                        finalize_with_source_audio = false;
                        existing_segments.clear();
                        effective_preset = preset.clone();
                    }
                }
            }
            None => {
                use crate::ffui_core::domain::{InputTimelineConfig, SeekMode};
                let timeline = InputTimelineConfig {
                    seek_mode: Some(SeekMode::Input),
                    seek_position: Some(format!("{seek:.6}")),
                    duration_mode: None,
                    duration: None,
                    accurate_seek: Some(true),
                };
                effective_preset.input = Some(timeline);
            }
        }
    }

    if resume_plan.is_some() && finalize_with_source_audio {
        use crate::ffui_core::domain::MappingConfig;
        let mapping = effective_preset.mapping.get_or_insert(MappingConfig {
            maps: None,
            metadata: None,
            dispositions: None,
        });
        let mut maps = mapping.maps.clone().unwrap_or_default();
        if maps.is_empty() {
            maps.push("0".to_string());
        }
        if !maps.iter().any(|m| m.trim() == "-0:a") {
            maps.push("-0:a".to_string());
        }
        mapping.maps = Some(maps);
    }

    if let Some(plan) = resume_plan.as_ref()
        && matches!(plan.strategy, ResumeStrategy::OverlapTrim)
        && plan.trim_at_seconds > 0.0
    {
        let start_time_seconds =
            detect_best_effort_video_start_time_seconds(input_path, settings_snapshot)
                .filter(|v| v.is_finite() && *v > 0.0)
                .unwrap_or(0.0);
        let adjusted_trim_start = (plan.trim_at_seconds + start_time_seconds).max(0.0);
        if start_time_seconds > 0.0 {
            let target_seconds = plan.trim_at_seconds;
            let mut state = inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id) {
                super::worker_utils::append_job_log_line(
                    job,
                    format!(
                        "resume: overlap+trim input start_time={start_time_seconds:.6}s; trimStartAbs={adjusted_trim_start:.6}s (target={target_seconds:.6}s)"
                    ),
                );
            }
        }

        // Use absolute timestamps from the source timeline and cut exactly at
        // the recorded join target. When `-copyts` is enabled and the input
        // starts at a non-zero timestamp, shift by start_time so
        // `trim=start=...` operates in the same timestamp domain.
        let injected = format!("trim=start={adjusted_trim_start:.6},setpts=PTS-STARTPTS");
        let existing = effective_preset
            .filters
            .vf_chain
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        effective_preset.filters.vf_chain = Some(match existing {
            // Append trim so any existing temporal filters can benefit from the
            // overlapped frames while the output is still cut exactly at the
            // join target.
            Some(chain) => format!("{chain},{injected}"),
            None => injected,
        });
    }

    ensure_fragmented_movflags_for_mp4_like_output(&mut effective_preset, output_path);
    (effective_preset, finalize_preset, finalize_with_source_audio)
}
