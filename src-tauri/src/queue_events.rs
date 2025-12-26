use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::ffui_core::{QueueStateLite, TranscodingEngine};
#[cfg(windows)]
use crate::taskbar_progress::update_taskbar_progress_lite;

fn parse_bool_env(value: Option<&str>, default: bool) -> bool {
    value.map_or(default, |raw| {
        match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        }
    })
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
    let pending_lite: Arc<Mutex<Option<QueueStateLite>>> = Arc::new(Mutex::new(None));
    let worker_running = Arc::new(AtomicBool::new(false));

    const EMIT_MIN_INTERVAL_MS: u64 = 50;

    engine.register_queue_lite_listener(move |state: QueueStateLite| {
        {
            let mut pending = pending_lite.lock().unwrap_or_else(|e| e.into_inner());
            *pending = Some(state);
        }

        if worker_running.swap(true, Ordering::AcqRel) {
            return;
        }

        let pending_lite = pending_lite.clone();
        let worker_running = worker_running.clone();
        let event_handle = event_handle.clone();
        let taskbar_handle = taskbar_handle.clone();

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let next = {
                    let mut pending = pending_lite.lock().unwrap_or_else(|e| e.into_inner());
                    pending.take()
                };

                let Some(lite) = next else {
                    worker_running.store(false, Ordering::Release);
                    let has_pending = {
                        let pending = pending_lite.lock().unwrap_or_else(|e| e.into_inner());
                        pending.is_some()
                    };
                    if has_pending && !worker_running.swap(true, Ordering::AcqRel) {
                        continue;
                    }
                    break;
                };

                // Legacy full snapshot event for compatibility. In production builds
                // this is opt-in to reduce IPC pressure and queue hot-path cloning.
                if emit_full_events {
                    let engine = taskbar_handle.state::<TranscodingEngine>();
                    let full = engine.queue_state();
                    if let Err(err) = event_handle.emit("ffui://queue-state", full) {
                        crate::debug_eprintln!("failed to emit queue-state event: {err}");
                    }
                }

                // Lightweight snapshot event used by the queue UI.
                if let Err(err) = event_handle.emit("ffui://queue-state-lite", &lite) {
                    crate::debug_eprintln!("failed to emit queue-state-lite event: {err}");
                }

                // Update the Windows taskbar progress bar (no-op on non-Windows
                // platforms) based on the aggregated queue progress for this snapshot.
                #[cfg(windows)]
                {
                    let engine = taskbar_handle.state::<TranscodingEngine>();
                    let settings = engine.settings();
                    update_taskbar_progress_lite(
                        &taskbar_handle,
                        &lite,
                        settings.taskbar_progress_mode,
                        settings.taskbar_progress_scope,
                    );
                }

                std::thread::sleep(Duration::from_millis(EMIT_MIN_INTERVAL_MS));
            }
        });
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
