use super::super::state::EngineState;
use super::super::worker_utils::current_time_millis;
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
    let now_ms = current_time_millis();
    let (input, preset_id) = state.jobs.get(finished_job_id).map_or((None, None), |job| {
        (Some(job.filename.clone()), Some(job.preset_id.clone()))
    });

    if let Some(preset_id) = preset_id {
        let did_update_time = state.note_preset_processing_stopped(&preset_id, now_ms);
        if did_update_time
            && let Err(err) = crate::ffui_core::settings::save_presets(state.presets.as_ref())
        {
            crate::debug_eprintln!(
                "failed to persist presets after wall-clock stats update: {err:#}"
            );
        }
    }

    state.active_jobs.remove(finished_job_id);
    if let Some(input) = input {
        state.active_inputs.remove(&input);
    }
    state.cancelled_jobs.remove(finished_job_id);

    next_job_for_worker_locked(state)
}
