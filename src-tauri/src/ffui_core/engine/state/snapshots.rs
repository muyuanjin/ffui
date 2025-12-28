use crate::ffui_core::domain::{QueueStateLite, TranscodeJobLite};

use super::{EngineState, build_queue_order_map, sort_jobs_by_queue_order_and_id};

pub(super) fn snapshot_queue_state_lite_from_locked_state(
    state: &mut EngineState,
) -> QueueStateLite {
    let snapshot_revision = state.queue_snapshot_revision;
    let order_by_id = build_queue_order_map(state);

    let mut jobs: Vec<TranscodeJobLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in &state.jobs {
        let mut lite = TranscodeJobLite::from(job);
        lite.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(lite);
    }

    sort_jobs_by_queue_order_and_id(&mut jobs);

    QueueStateLite {
        snapshot_revision,
        jobs,
    }
}
