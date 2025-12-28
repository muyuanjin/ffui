use crate::ffui_core::domain::{QueueStateUiLite, TranscodeJobUiLite};
use crate::sync_ext::MutexExt;

use super::{
    EngineState, Inner, QueueOrderSortable, build_queue_order_map, sort_jobs_by_queue_order_and_id,
};

impl QueueOrderSortable for TranscodeJobUiLite {
    fn id_str(&self) -> &str {
        self.id.as_str()
    }

    fn queue_order(&self) -> Option<u64> {
        self.queue_order
    }
}

fn snapshot_queue_state_ui_lite_from_locked_state(state: &mut EngineState) -> QueueStateUiLite {
    let snapshot_revision = state.queue_snapshot_revision;
    let order_by_id = build_queue_order_map(state);

    let mut jobs: Vec<TranscodeJobUiLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in &state.jobs {
        let mut lite = TranscodeJobUiLite::from(job);
        lite.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(lite);
    }

    sort_jobs_by_queue_order_and_id(&mut jobs);

    QueueStateUiLite {
        snapshot_revision,
        jobs,
    }
}

pub(in crate::ffui_core::engine) fn snapshot_queue_state_ui_lite(
    inner: &Inner,
) -> QueueStateUiLite {
    let mut state = inner.state.lock_unpoisoned();
    snapshot_queue_state_ui_lite_from_locked_state(&mut state)
}
