use super::{EngineState, Inner, QueueStateLiteDelta};
use crate::ffui_core::TranscodeJobLiteDeltaPatch;
use crate::sync_ext::MutexExt;

impl EngineState {
    pub(in crate::ffui_core::engine) fn stage_queue_lite_delta(
        &mut self,
        patches: Vec<TranscodeJobLiteDeltaPatch>,
    ) {
        self.queue_delta_revision = self.queue_delta_revision.saturating_add(1);
        self.pending_queue_deltas.push_back(QueueStateLiteDelta {
            base_snapshot_revision: self.queue_snapshot_revision,
            delta_revision: self.queue_delta_revision,
            patches,
        });
    }
}

struct DeltaDispatchGuard<'inner> {
    inner: &'inner Inner,
    active: bool,
}

impl Drop for DeltaDispatchGuard<'_> {
    fn drop(&mut self) {
        if self.active {
            self.inner.state.lock_unpoisoned().queue_delta_dispatching = false;
        }
    }
}

pub(in crate::ffui_core::engine) fn notify_queue_lite_delta_listeners(inner: &Inner) {
    {
        let mut state = inner.state.lock_unpoisoned();
        if state.queue_delta_dispatching {
            return;
        }
        state.queue_delta_dispatching = true;
    }
    let mut dispatch = DeltaDispatchGuard {
        inner,
        active: true,
    };
    loop {
        let delta = {
            let mut state = inner.state.lock_unpoisoned();
            let delta = state.pending_queue_deltas.pop_front();
            if delta.is_none() {
                state.queue_delta_dispatching = false;
                dispatch.active = false;
            }
            delta
        };
        let Some(delta) = delta else {
            return;
        };
        let listeners = inner.queue_lite_delta_listeners.lock_unpoisoned().clone();
        for listener in listeners {
            listener(delta.clone());
        }
    }
}

#[cfg(test)]
mod tests;
