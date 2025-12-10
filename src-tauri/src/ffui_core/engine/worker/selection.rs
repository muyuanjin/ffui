use crate::ffui_core::domain::JobStatus;

use super::super::state::EngineState;
use super::super::worker_utils::current_time_millis;

/// Pop the next job id and mark it processing under lock (used by workers/tests).
pub(in crate::ffui_core::engine) fn next_job_for_worker_locked(
    state: &mut EngineState,
) -> Option<String> {
    let job_id = state.queue.pop_front()?;
    state.active_job = Some(job_id.clone());

    if let Some(job) = state.jobs.get_mut(&job_id) {
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
