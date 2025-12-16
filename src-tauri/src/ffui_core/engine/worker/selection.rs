use crate::ffui_core::domain::JobStatus;
use crate::ffui_core::domain::{EncoderType, FFmpegPreset, TranscodeJob};
use crate::ffui_core::settings::TranscodeParallelismMode;

use super::super::state::EngineState;
use super::super::worker_utils::current_time_millis;

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
        for id in state.active_jobs.iter() {
            let Some(job) = state.jobs.get(id) else { continue };
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
        matches!(job.status, JobStatus::Waiting | JobStatus::Queued)
            && !state.active_inputs.contains(&job.filename)
            && {
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

    if let Some(job) = state.jobs.get_mut(&job_id) {
        state.active_jobs.insert(job_id.clone());
        state.active_inputs.insert(job.filename.clone());
        job.status = JobStatus::Processing;
        if job.start_time.is_none() {
            job.start_time = Some(current_time_millis());
        }
        // 记录实际进入 Processing 的时间，用于计算纯处理耗时（不含排队）。
        job.processing_started_ms = Some(current_time_millis());
        // For fresh jobs we start from 0%, but for resumed jobs that already
        // have meaningful progress and wait metadata we keep the existing
        // percentage so the UI does not jump backwards when continuing from
        // a partial output segment.
        if job.progress <= 0.0 || job.wait_metadata.is_none() || !job.progress.is_finite() {
            job.progress = 0.0;
        }
    }

    Some(job_id)
}

fn classify_job(state: &EngineState, job: &TranscodeJob) -> ParallelismClass {
    let preset = state.presets.iter().find(|p| p.id == job.preset_id);
    preset
        .map(classify_preset)
        .unwrap_or(ParallelismClass::Cpu)
}

fn classify_preset(preset: &FFmpegPreset) -> ParallelismClass {
    if preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        && let Some(template) = preset.ffmpeg_template.as_deref()
        && let Some(enc) = infer_template_video_encoder(template)
    {
        if is_hardware_encoder_name(enc) {
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

fn infer_template_video_encoder(template: &str) -> Option<&str> {
    // Best-effort: scan output-scoped `-c:v <x>` before OUTPUT.
    let tokens: Vec<&str> = template.split_whitespace().collect();
    let output_index = tokens.iter().position(|t| *t == "OUTPUT")?;

    let mut i = 0usize;
    let mut last_input_index: Option<usize> = None;
    while i + 1 < output_index {
        if tokens[i] == "-i" {
            last_input_index = Some(i + 1);
            i += 2;
            continue;
        }
        i += 1;
    }
    let start = last_input_index.map(|idx| idx + 1).unwrap_or(0);

    let mut j = start;
    let mut v: Option<&str> = None;
    while j + 1 < output_index {
        if tokens[j] == "-c:v" {
            v = Some(tokens[j + 1]);
            j += 2;
            continue;
        }
        j += 1;
    }
    v
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
