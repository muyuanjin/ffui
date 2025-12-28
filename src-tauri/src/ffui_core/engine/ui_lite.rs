use crate::ffui_core::domain::QueueStateUiLite;

use super::{TranscodingEngine, state::snapshot_queue_state_ui_lite};

impl TranscodingEngine {
    /// Get the UI-facing lightweight snapshot of the current queue state.
    ///
    /// This is the preferred payload for frontend delivery (startup + push events)
    /// because it omits crash-recovery-only fields.
    pub fn queue_state_ui_lite(&self) -> QueueStateUiLite {
        snapshot_queue_state_ui_lite(&self.inner)
    }
}
