use crate::ffui_core::JobExecution;

use super::super::output_policy_paths::plan_video_output_path;
use super::super::state::EngineState;
use super::super::worker_utils::append_job_log_line;
use super::plan_manual_execution;

pub(in crate::ffui_core::engine) fn hydrate_legacy_job_snapshot(
    job: &mut crate::ffui_core::TranscodeJob,
    state: &EngineState,
) {
    if job.execution.is_some() || !matches!(job.source, crate::ffui_core::JobSource::Manual) {
        return;
    }
    let policy = match &job.output_policy {
        Some(policy) => policy.clone(),
        None => {
            if let Some(error) = state.settings_capability_error(&["/queueOutputPolicy"]) {
                let reason = format!("Cannot restore legacy execution: {error}");
                job.execution = Some(JobExecution::Invalid {
                    reason: reason.clone(),
                });
                job.failure_reason = Some(reason.clone());
                append_job_log_line(job, reason);
                return;
            }
            state.settings.queue_output_policy.clone()
        }
    };
    let preset = state
        .presets
        .iter()
        .find(|preset| preset.id == job.preset_id);
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
            plan_video_output_path(&input, preset, &policy, |candidate| candidate.exists())
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
    let plan = preset.map_or_else(
        || Err(format!("No preset found for preset id '{}'", job.preset_id)),
        |preset| plan_manual_execution(&input, preset, &output, &policy),
    );
    job.output_path = plan.as_ref().ok().and_then(|plan| plan.output_path.clone());
    let execution = plan
        .map(|plan| plan.execution)
        .unwrap_or_else(|reason| JobExecution::Invalid { reason });
    if let JobExecution::Invalid { reason } = &execution {
        job.failure_reason = Some(reason.clone());
        append_job_log_line(job, reason.clone());
    }
    job.input_path = Some(input.to_string_lossy().into_owned());
    job.output_policy = Some(policy);
    job.execution = Some(execution);
    append_job_log_line(
        job,
        "Legacy execution configuration was snapshotted before running".to_string(),
    );
}
