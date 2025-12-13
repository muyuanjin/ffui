use crate::ffui_core::domain::JobStatus;

use super::super::state::EngineState;
use super::super::worker_utils::current_time_millis;

/// Pop the next job id and mark it processing under lock (used by workers/tests).
pub(in crate::ffui_core::engine) fn next_job_for_worker_locked(
    state: &mut EngineState,
) -> Option<String> {
    // Find the first job that is eligible to run. Jobs can be temporarily
    // ineligible when another worker is already processing the same input
    // file (e.g. duplicate enqueues for the same path).
    let index = state.queue.iter().position(|id| {
        let Some(job) = state.jobs.get(id) else {
            return false;
        };
        matches!(job.status, JobStatus::Waiting | JobStatus::Queued)
            && !state.active_inputs.contains(&job.filename)
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
