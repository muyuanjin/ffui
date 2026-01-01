use super::super::state::EngineState;
use super::super::worker_utils::current_time_millis;
use crate::ffui_core::domain::{EncoderType, FFmpegPreset, JobStatus, TranscodeJob, WaitMetadata};
use crate::ffui_core::engine::ffmpeg_args::compute_progress_percent;
use crate::ffui_core::settings::TranscodeParallelismMode;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ParallelismClass {
    Cpu,
    Hardware,
}

/// Pop the next job id and mark it processing under lock (used by workers/tests).
pub(in crate::ffui_core::engine) fn next_job_for_worker_locked(
    state: &mut EngineState,
) -> Option<String> {
    let mode = state.settings.parallelism_mode();

    if mode == TranscodeParallelismMode::Unified {
        let cap = state.settings.effective_max_parallel_jobs() as usize;
        if state.active_jobs.len() >= cap.max(1) {
            return None;
        }
    }

    let (cpu_cap, hw_cap, active_cpu, active_hw) = if mode == TranscodeParallelismMode::Split {
        let cpu_cap = state.settings.effective_max_parallel_cpu_jobs() as usize;
        let hw_cap = state.settings.effective_max_parallel_hw_jobs() as usize;
        let mut active_cpu = 0usize;
        let mut active_hw = 0usize;
        for id in &state.active_jobs {
            let Some(job) = state.jobs.get(id) else {
                continue;
            };
            match classify_job(state, job) {
                ParallelismClass::Cpu => active_cpu += 1,
                ParallelismClass::Hardware => active_hw += 1,
            }
        }
        (cpu_cap.max(1), hw_cap.max(1), active_cpu, active_hw)
    } else {
        (0usize, 0usize, 0usize, 0usize)
    };

    // Find the first job that is eligible to run. Jobs can be temporarily
    // ineligible when another worker is already processing the same input
    // file (e.g. duplicate enqueues for the same path).
    let index = state.queue.iter().position(|id| {
        let Some(job) = state.jobs.get(id) else {
            return false;
        };
        matches!(job.status, JobStatus::Queued) && !state.active_inputs.contains(&job.filename) && {
            if mode != TranscodeParallelismMode::Split {
                return true;
            }
            match classify_job(state, job) {
                ParallelismClass::Cpu => active_cpu < cpu_cap,
                ParallelismClass::Hardware => active_hw < hw_cap,
            }
        }
    })?;

    let job_id = if index == 0 {
        state.queue.pop_front()?
    } else {
        state.queue.remove(index)?
    };

    let now_ms = current_time_millis();
    let preset_id = state.jobs.get(&job_id).map(|job| job.preset_id.clone());
    if let Some(preset_id) = preset_id {
        state.note_preset_processing_started(&preset_id, now_ms);
    }

    if let Some(job) = state.jobs.get_mut(&job_id) {
        state.active_jobs.insert(job_id.clone());
        state.active_inputs.insert(job.filename.clone());
        job.status = JobStatus::Processing;
        if job.start_time.is_none() {
            job.start_time = Some(now_ms);
        }
        // 记录实际进入 Processing 的时间，用于计算纯处理耗时（不含排队）。
        job.processing_started_ms = Some(now_ms);

        // Progress epoch: each ffmpeg invocation (including resume) starts a new
        // monotonic progress run. This lets the frontend animate real rollbacks
        // (e.g. conservative overlap on resume) without "teleporting".
        if let Some(meta) = job.wait_metadata.as_mut() {
            let next_epoch = meta.progress_epoch.unwrap_or(0).saturating_add(1);
            meta.progress_epoch = Some(next_epoch);

            let baseline_out_time_seconds = meta
                .target_seconds
                .or(meta.processed_seconds)
                .or(meta.last_progress_out_time_seconds)
                .unwrap_or(0.0);
            if baseline_out_time_seconds.is_finite() && baseline_out_time_seconds >= 0.0 {
                meta.last_progress_out_time_seconds = Some(baseline_out_time_seconds);
                meta.last_progress_speed = None;
                meta.last_progress_updated_at_ms = Some(now_ms);

                if let Some(total) = job.media_info.as_ref().and_then(|m| m.duration_seconds)
                    && total.is_finite()
                    && total > 0.0
                {
                    let mut baseline_progress =
                        compute_progress_percent(Some(total), baseline_out_time_seconds);
                    if baseline_progress >= 100.0 {
                        baseline_progress = 99.9;
                    }
                    if baseline_progress.is_finite()
                        && (!job.progress.is_finite()
                            || (job.progress - baseline_progress).abs() > 0.05)
                    {
                        job.progress = baseline_progress;
                    }
                }
            }
        }

        // For fresh jobs we start from 0%, but for resumed jobs that already
        // have meaningful progress and wait metadata we keep the existing
        // percentage so the UI does not jump backwards when continuing from
        // a partial output segment.
        let had_crash_recovery_evidence =
            job.progress > 0.0 || job.elapsed_ms.is_some_and(|ms| ms > 0);
        if job.wait_metadata.is_none() && had_crash_recovery_evidence {
            let previous_progress = job.progress;
            // Preserve resume evidence for best-effort crash recovery probing
            // without implying resumable segment paths (segments/tmp_output_path).
            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: Some(previous_progress),
                processed_wall_millis: job.elapsed_ms,
                processed_seconds: None,
                target_seconds: None,
                progress_epoch: Some(1),
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: None,
                tmp_output_path: None,
                segments: None,
                segment_end_targets: None,
            });
            // Treat the current run as fresh until a probe recovers actual
            // resumable segment paths; otherwise early progress updates would
            // be suppressed by the monotonic progress guard.
            job.progress = 0.0;
        }

        if job.progress <= 0.0 || job.wait_metadata.is_none() || !job.progress.is_finite() {
            job.progress = 0.0;
        }
    }

    Some(job_id)
}

fn classify_job(state: &EngineState, job: &TranscodeJob) -> ParallelismClass {
    let preset = state.presets.iter().find(|p| p.id == job.preset_id);
    preset.map_or(ParallelismClass::Cpu, classify_preset)
}

fn classify_preset(preset: &FFmpegPreset) -> ParallelismClass {
    if preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
        && let Some(template) = preset.ffmpeg_template.as_deref()
        && let (Some(enc), _) =
            crate::ffui_core::engine::output_policy_paths::infer_template_output_codecs(template)
    {
        if is_hardware_encoder_name(enc.as_str()) {
            return ParallelismClass::Hardware;
        }
        return ParallelismClass::Cpu;
    }

    match preset.video.encoder {
        EncoderType::HevcNvenc
        | EncoderType::H264Nvenc
        | EncoderType::Av1Nvenc
        | EncoderType::HevcQsv
        | EncoderType::Av1Qsv
        | EncoderType::HevcAmf
        | EncoderType::Av1Amf => ParallelismClass::Hardware,
        _ => ParallelismClass::Cpu,
    }
}

fn is_hardware_encoder_name(encoder: &str) -> bool {
    let enc = encoder.trim().to_ascii_lowercase();
    enc.ends_with("_nvenc")
        || enc.ends_with("_qsv")
        || enc.ends_with("_amf")
        || enc.ends_with("_vaapi")
        || enc.ends_with("_v4l2m2m")
        || enc.contains("videotoolbox")
}
