use tauri::{AppHandle, Emitter, Manager};

use crate::ffui_core::{QueueState, QueueStateLite, TranscodingEngine};
use crate::taskbar_progress::update_taskbar_progress;

fn parse_bool_env(value: Option<&str>, default: bool) -> bool {
    match value {
        None => default,
        Some(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        },
    }
}

fn full_queue_state_events_enabled() -> bool {
    let default = cfg!(debug_assertions);
    let env_value = std::env::var("FFUI_QUEUE_STATE_FULL_EVENTS").ok();
    parse_bool_env(env_value.as_deref(), default)
}

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
    let emit_full_events = full_queue_state_events_enabled();

    engine.register_queue_listener(move |state: QueueState| {
        // Legacy full snapshot event for compatibility. In production builds
        // this is opt-in to reduce startup IPC pressure.
        if emit_full_events && let Err(err) = event_handle.emit("ffui://queue-state", state.clone())
        {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bool_env_handles_truthy_and_falsy_values() {
        assert!(parse_bool_env(Some("1"), false));
        assert!(parse_bool_env(Some("true"), false));
        assert!(parse_bool_env(Some("YES"), false));
        assert!(parse_bool_env(Some("on"), false));

        assert!(!parse_bool_env(Some("0"), true));
        assert!(!parse_bool_env(Some("false"), true));
        assert!(!parse_bool_env(Some("No"), true));
        assert!(!parse_bool_env(Some("off"), true));
    }

    #[test]
    fn parse_bool_env_falls_back_to_default_on_unknown_or_missing() {
        assert!(parse_bool_env(None, true));
        assert!(!parse_bool_env(None, false));
        assert!(parse_bool_env(Some("maybe"), true));
        assert!(!parse_bool_env(Some("maybe"), false));
    }
}
