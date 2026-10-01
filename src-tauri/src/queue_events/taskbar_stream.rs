use super::PendingQueueLiteDelta;
use crate::ffui_core::{
    QueueStateLiteDelta, QueueStateUiLite, TaskbarProgressDeltaTracker, TaskbarProgressMode,
    TaskbarProgressScope,
};

#[derive(Debug, Default)]
pub(super) struct TaskbarProgressStream {
    pub tracker: TaskbarProgressDeltaTracker,
    latest_delta_revision: u64,
    pending: PendingQueueLiteDelta,
}

impl TaskbarProgressStream {
    pub fn snapshot(
        &mut self,
        snapshot: &QueueStateUiLite,
        mode: TaskbarProgressMode,
        scope: TaskbarProgressScope,
    ) -> bool {
        if self.tracker.base_snapshot_revision().is_some_and(|base| {
            base > snapshot.snapshot_revision
                || (base == snapshot.snapshot_revision
                    && self.latest_delta_revision > snapshot.latest_delta_revision)
        }) {
            return false;
        }
        self.tracker.reset_from_ui_lite(snapshot, mode, scope);
        self.latest_delta_revision = snapshot.latest_delta_revision;
        if self
            .pending
            .base_snapshot_revision
            .is_some_and(|base| base <= snapshot.snapshot_revision)
            && let Some(delta) = self.pending.take_coalesced()
            && delta.base_snapshot_revision == snapshot.snapshot_revision
        {
            self.delta(&delta, mode, scope);
        }
        true
    }

    pub fn delta(
        &mut self,
        delta: &QueueStateLiteDelta,
        mode: TaskbarProgressMode,
        scope: TaskbarProgressScope,
    ) {
        match self.tracker.base_snapshot_revision() {
            Some(base) if delta.base_snapshot_revision < base => {}
            Some(base) if delta.base_snapshot_revision == base => {
                if delta.delta_revision <= self.latest_delta_revision {
                    return;
                }
                self.tracker.apply_delta(delta, mode, scope);
                self.latest_delta_revision = delta.delta_revision;
            }
            _ => {
                if self
                    .pending
                    .base_snapshot_revision
                    .is_none_or(|base| base <= delta.base_snapshot_revision)
                {
                    self.pending.push(delta.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
