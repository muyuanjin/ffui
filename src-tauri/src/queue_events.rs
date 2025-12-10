use tauri::{AppHandle, Emitter, Manager};

use crate::ffui_core::{QueueState, QueueStateLite, TranscodingEngine};
use crate::taskbar_progress::update_taskbar_progress;

/// Register queue state event streaming from the Rust engine to the frontend.
///
/// This wires a listener on the `TranscodingEngine` that emits both a legacy
/// `ffui://queue-state` event carrying the full snapshot and a lightweight
/// `ffui://queue-state-lite` event carrying the trimmed shape used by the
/// queue UI.
pub fn register_queue_stream(handle: &AppHandle) {
    let event_handle = handle.clone();
    let taskbar_handle = handle.clone();
    let engine = handle.state::<TranscodingEngine>();

    engine.register_queue_listener(move |state: QueueState| {
        // Legacy full snapshot event for compatibility.
        if let Err(err) = event_handle.emit("ffui://queue-state", state.clone()) {
            eprintln!("failed to emit queue-state event: {err}");
        }

        // Lightweight snapshot event used by the queue UI. This strips heavy
        // fields from the payload (e.g. full logs) while keeping list
        // rendering fields intact.
        if let Err(err) = event_handle.emit("ffui://queue-state-lite", QueueStateLite::from(&state))
        {
            eprintln!("failed to emit queue-state-lite event: {err}");
        }

        // Update the Windows taskbar progress bar (no-op on non-Windows
        // platforms) based on the aggregated queue progress for this
        // snapshot.
        #[cfg(windows)]
        {
            let engine = taskbar_handle.state::<TranscodingEngine>();
            let settings = engine.settings();
            update_taskbar_progress(
                &taskbar_handle,
                &state,
                settings.taskbar_progress_mode,
                settings.taskbar_progress_scope,
            );
        }
    });
}
