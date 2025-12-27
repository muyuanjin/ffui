use super::super::state::EngineState;
use super::selection::next_job_for_worker_locked;

/// Finish an active job (remove from active sets) and immediately start the next eligible job
/// under the same lock, returning the next job id when available.
///
/// This supports atomic worker handoffs so the frontend does not observe a transient
/// "no processing jobs" state between back-to-back jobs.
pub(in crate::ffui_core::engine) fn finish_job_and_try_start_next_locked(
    state: &mut EngineState,
    finished_job_id: &str,
) -> Option<String> {
    let input = state
        .jobs
        .get(finished_job_id)
        .map(|job| job.filename.clone());
    state.active_jobs.remove(finished_job_id);
    if let Some(input) = input {
        state.active_inputs.remove(&input);
    }
    state.cancelled_jobs.remove(finished_job_id);

    next_job_for_worker_locked(state)
}
