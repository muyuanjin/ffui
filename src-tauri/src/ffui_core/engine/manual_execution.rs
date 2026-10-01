use std::path::Path;

use crate::ffui_core::domain::{
    FFmpegPreset, FfmpegInvocation, FfmpegOutput, FfmpegProgress, JobExecution, JobType,
    OutputPolicy,
};

use super::batch_compress::{is_audio_file, is_image_file, is_video_file};
use super::ffmpeg_args::{
    build_ffmpeg_args, effective_output_muxer, preset_requires_two_pass,
    validate_structured_execution_preset,
};
use super::template_args::strip_leading_ffmpeg_program;

pub(super) fn presentation_type(input: &Path) -> JobType {
    if is_audio_file(input) {
        JobType::Audio
    } else if is_image_file(input) {
        JobType::Image
    } else if is_video_file(input) {
        JobType::Video
    } else {
        JobType::Other
    }
}

pub(super) fn parse_command(template: &str) -> Result<Vec<String>, String> {
    let mut args = split_command_args(template, false)?;
    strip_leading_ffmpeg_program(&mut args);
    Ok(args)
}

pub(crate) fn parse_ffmpeg_command(command: &str) -> Result<Vec<String>, String> {
    let mut args = split_command_args(command, true)?;
    let program = args.first().map(|argument| argument.to_lowercase());
    let basename = program
        .as_deref()
        .and_then(|program| program.rsplit(['/', '\\']).next());
    if !matches!(basename, Some("ffmpeg" | "ffmpeg.exe")) {
        return Err("Start the command with ffmpeg or ffmpeg.exe".to_string());
    }
    strip_leading_ffmpeg_program(&mut args);
    validate_invocation(&FfmpegInvocation {
        args: args.clone(),
        working_directory: None,
        progress: None,
        output: FfmpegOutput::Transparent,
    })?;
    Ok(args)
}

fn split_command_args(template: &str, reject_shell_syntax: bool) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = template.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '|' | '&' | ';' | '<' | '>' | '`' if reject_shell_syntax && quote.is_none() => {
                return Err("Shell operators, redirection and command substitution are not supported; quote literal values".to_string());
            }
            '\'' | '"' if quote.is_none() => {
                quote = Some(character);
                started = true;
            }
            closing if quote == Some(closing) => quote = None,
            '\\' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push(chars.next().expect("peeked quote"));
            }
            whitespace if whitespace.is_whitespace() && quote.is_none() => {
                if started {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            other => {
                current.push(other);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("Unclosed quote in FFmpeg command".to_string());
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

pub(super) fn validate_invocation(invocation: &FfmpegInvocation) -> Result<(), String> {
    if invocation.progress.is_some() && matches!(invocation.output, FfmpegOutput::Transparent) {
        return Err("Input-duration progress requires a managed recipe".to_string());
    }
    if invocation.args.is_empty() {
        return Err("FFmpeg arguments must not be empty".to_string());
    }
    if invocation
        .args
        .iter()
        .any(|argument| argument.contains('\0'))
    {
        return Err("FFmpeg arguments must not contain NUL".to_string());
    }
    let progress_targets = progress_target_indices(&invocation.args);
    if invocation.args.iter().enumerate().any(|(index, argument)| {
        !progress_targets.contains(&index)
            && (argument == "-" || argument.starts_with("pipe:") || argument.starts_with("fd:"))
    }) {
        return Err("Media stdin/stdout pipes are not supported by the queue".to_string());
    }
    if let Some(directory) = &invocation.working_directory
        && (directory.is_empty() || directory.contains('\0'))
    {
        return Err("Working directory must be a non-empty path without NUL".to_string());
    }
    if let FfmpegOutput::ManagedFile {
        path,
        argument_index,
    } = &invocation.output
    {
        let index = *argument_index as usize;
        if invocation.args.get(index) != Some(path) || index + 1 != invocation.args.len() {
            return Err("Managed output must bind the final output argument".to_string());
        }
        if path.is_empty() {
            return Err("Managed output must be a single literal file path".to_string());
        }
    }
    Ok(())
}

fn progress_target_indices(args: &[String]) -> Vec<usize> {
    let mut targets = Vec::new();
    let mut index = 0;
    let mut escaped_output = false;
    while index < args.len() {
        let argument = &args[index];
        if argument == "--" {
            escaped_output = true;
            index += 1;
            continue;
        }
        if std::mem::take(&mut escaped_output) {
            index += 1;
            continue;
        }
        let Some(option) = argument
            .strip_prefix('-')
            .filter(|option| !option.is_empty())
        else {
            index += 1;
            continue;
        };
        let option = option.split(':').next().expect("option name");
        if option == "progress" && index + 1 < args.len() {
            targets.push(index + 1);
        }
        index += if is_valueless_option(option) { 1 } else { 2 };
    }
    targets
}

fn is_valueless_option(option: &str) -> bool {
    if matches!(option, "vstats" | "qphist" | "report") {
        return true;
    }
    matches!(
        option.strip_prefix("no").unwrap_or(option),
        "y" | "n"
            | "hide_banner"
            | "ignore_unknown"
            | "copy_unknown"
            | "recast_media"
            | "accurate_seek"
            | "benchmark"
            | "benchmark_all"
            | "stdin"
            | "dump"
            | "hex"
            | "re"
            | "copyts"
            | "start_at_zero"
            | "shortest"
            | "bitexact"
            | "xerror"
            | "copyinkf"
            | "auto_conversion_filters"
            | "stats"
            | "debug_ts"
            | "find_stream_info"
            | "display_hflip"
            | "display_vflip"
            | "vn"
            | "force_fps"
            | "autorotate"
            | "autoscale"
            | "fix_sub_duration_heartbeat"
            | "an"
            | "sn"
            | "fix_sub_duration"
            | "dn"
            | "print_graphs"
            | "intra"
            | "deinterlace"
            | "psnr"
    )
}

pub(super) fn plan_manual_execution(
    input: &Path,
    preset: &FFmpegPreset,
    output: &Path,
    policy: &OutputPolicy,
) -> Result<JobExecution, String> {
    if preset.advanced_enabled.unwrap_or(false) {
        let template = preset
            .ffmpeg_template
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Advanced preset has no FFmpeg command".to_string())?;
        let mut args = parse_command(template)?;
        for argument in &mut args {
            match argument.as_str() {
                "INPUT" => *argument = input.to_string_lossy().into_owned(),
                "OUTPUT" => *argument = output.to_string_lossy().into_owned(),
                _ => {}
            }
        }
        let invocation = FfmpegInvocation {
            args,
            working_directory: None,
            progress: None,
            output: FfmpegOutput::Transparent,
        };
        validate_invocation(&invocation)?;
        return Ok(JobExecution::Ffmpeg { invocation });
    }

    validate_structured_execution_preset(preset)?;
    if presentation_type(input) == JobType::Video {
        return Ok(JobExecution::Video {
            preset: Box::new(preset.clone()),
        });
    }
    if preset_requires_two_pass(preset) {
        return Err("Structured two-pass execution requires a video recipe".to_string());
    }
    let input = std::path::absolute(input)
        .map_err(|error| format!("Cannot resolve input file address: {error}"))?;
    let output = std::path::absolute(output)
        .map_err(|error| format!("Cannot resolve output file address: {error}"))?;
    let working_directory = std::env::current_dir()
        .map_err(|error| format!("Cannot snapshot working directory: {error}"))?;
    let muxer = effective_output_muxer(preset, &input, &output, policy);
    if muxer.as_deref().is_some_and(|muxer| {
        matches!(
            muxer,
            "hls"
                | "dash"
                | "segment"
                | "stream_segment"
                | "ssegment"
                | "tee"
                | "webm_chunk"
                | "smoothstreaming"
        )
    }) {
        return Err("Multi-file outputs require a transparent FFmpeg command".to_string());
    }

    let args = build_ffmpeg_args(preset, &input, &output, true, Some(policy));
    if muxer.as_deref() == Some("image2")
        && output.to_string_lossy().split('%').skip(1).any(|suffix| {
            suffix
                .trim_start_matches(|character: char| character.is_ascii_digit())
                .starts_with('d')
        })
    {
        return Err("Image sequence outputs require a transparent FFmpeg command".to_string());
    }
    let argument_index = u32::try_from(args.len().saturating_sub(1))
        .map_err(|_| "Too many FFmpeg arguments".to_string())?;
    let invocation = FfmpegInvocation {
        args,
        working_directory: Some(working_directory.to_string_lossy().into_owned()),
        progress: preserves_input_duration(preset).then_some(FfmpegProgress::InputDuration),
        output: FfmpegOutput::ManagedFile {
            path: output.to_string_lossy().into_owned(),
            argument_index,
        },
    };
    validate_invocation(&invocation)?;
    Ok(JobExecution::Ffmpeg { invocation })
}

fn preserves_input_duration(preset: &FFmpegPreset) -> bool {
    let no_expression =
        |value: &Option<String>| value.as_ref().is_none_or(|value| value.trim().is_empty());
    preset.input.as_ref().is_none_or(|input| {
        no_expression(&input.seek_position)
            && input.stream_loop.is_none_or(|count| count == 0)
            && no_expression(&input.input_time_offset)
            && no_expression(&input.duration)
    }) && no_expression(&preset.filters.af_chain)
        && no_expression(&preset.filters.vf_chain)
        && no_expression(&preset.filters.filter_complex)
}

pub(super) fn hydrate_legacy_manual_job(inner: &super::state::Inner, job_id: &str) {
    use crate::sync_ext::MutexExt;
    let mut state = inner.state.lock_unpoisoned();
    let Some(mut job) = state
        .jobs
        .get(job_id)
        .filter(|job| {
            job.execution.is_none() && matches!(job.source, crate::ffui_core::JobSource::Manual)
        })
        .cloned()
    else {
        return;
    };
    hydrate_legacy_job_snapshot(
        &mut job,
        &state.presets,
        &state.settings.queue_output_policy,
    );
    state.jobs.insert(job_id.to_string(), job);
}

pub(super) fn hydrate_legacy_jobs(inner: &super::state::Inner, job_ids: &[String]) {
    use crate::sync_ext::MutexExt;
    let eligible = {
        let state = inner.state.lock_unpoisoned();
        job_ids
            .iter()
            .filter(|job_id| {
                state.jobs.get(*job_id).is_some_and(|job| {
                    job.execution.is_none()
                        && matches!(job.source, crate::ffui_core::JobSource::Manual)
                        && matches!(
                            job.status,
                            crate::ffui_core::JobStatus::Queued
                                | crate::ffui_core::JobStatus::Paused
                                | crate::ffui_core::JobStatus::Processing
                        )
                })
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    for job_id in eligible {
        hydrate_legacy_manual_job(inner, &job_id);
    }
}

pub(super) fn hydrate_legacy_job_snapshot(
    job: &mut crate::ffui_core::TranscodeJob,
    presets: &[FFmpegPreset],
    default_policy: &OutputPolicy,
) {
    if job.execution.is_some() || !matches!(job.source, crate::ffui_core::JobSource::Manual) {
        return;
    }
    let policy = job
        .output_policy
        .clone()
        .unwrap_or_else(|| default_policy.clone());
    let preset = presets.iter().find(|preset| preset.id == job.preset_id);
    let input = match std::path::absolute(job.input_path.as_deref().unwrap_or(&job.filename)) {
        Ok(path) => path,
        Err(error) => {
            job.execution = Some(JobExecution::Invalid {
                reason: format!("Cannot resolve legacy input file address: {error}"),
            });
            return;
        }
    };
    let output = job
        .output_path
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            super::output_policy_paths::plan_video_output_path(
                &input,
                preset,
                &policy,
                |candidate| candidate.exists(),
            )
            .output_path
        });
    let output = match std::path::absolute(output) {
        Ok(path) => path,
        Err(error) => {
            job.execution = Some(JobExecution::Invalid {
                reason: format!("Cannot resolve legacy output file address: {error}"),
            });
            return;
        }
    };
    let execution = preset.map_or_else(
        || JobExecution::Invalid {
            reason: format!("No preset found for preset id '{}'", job.preset_id),
        },
        |preset| {
            plan_manual_execution(&input, preset, &output, &policy)
                .unwrap_or_else(|reason| JobExecution::Invalid { reason })
        },
    );
    let transparent = matches!(&execution, JobExecution::Ffmpeg { invocation } if matches!(invocation.output, FfmpegOutput::Transparent));
    if let JobExecution::Invalid { reason } = &execution {
        job.failure_reason = Some(reason.clone());
        super::worker_utils::append_job_log_line(job, reason.clone());
    }
    job.input_path = Some(input.to_string_lossy().into_owned());
    job.output_path = (!transparent).then(|| output.to_string_lossy().into_owned());
    job.output_policy = Some(policy);
    job.execution = Some(execution);
    super::worker_utils::append_job_log_line(
        job,
        "Legacy execution configuration was snapshotted before running".to_string(),
    );
}

#[cfg(test)]
mod tests;
