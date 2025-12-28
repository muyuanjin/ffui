use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::ffui_core::{QueueStateLite, QueueStateLiteDelta, QueueStateUiLite, TranscodingEngine};
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

fn delta_emit_interval_ms() -> u64 {
    // Default to a conservative cadence in release builds to keep the UI smooth
    // even on weaker machines. Debug builds keep a tighter loop for dev UX.
    let default = if cfg!(debug_assertions) { 50 } else { 100 };
    let env_value = std::env::var("FFUI_QUEUE_STATE_DELTA_EMIT_MS").ok();
    env_value
        .as_deref()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(default)
}

#[derive(Debug, Default)]
struct PendingQueueLiteDelta {
    base_snapshot_revision: Option<u64>,
    max_delta_revision: Option<u64>,
    patches_by_id: HashMap<String, QueueStateLiteDeltaPatchEntry>,
}

#[derive(Debug, Clone)]
struct QueueStateLiteDeltaPatchEntry {
    delta_revision: u64,
    patch: crate::ffui_core::TranscodeJobLiteDeltaPatch,
}

fn merge_queue_state_lite_delta_patch(
    into: &mut crate::ffui_core::TranscodeJobLiteDeltaPatch,
    newer: crate::ffui_core::TranscodeJobLiteDeltaPatch,
) {
    debug_assert_eq!(into.id, newer.id);
    if newer.status.is_some() {
        into.status = newer.status;
    }
    if newer.progress.is_some() {
        into.progress = newer.progress;
    }
    if newer.progress_out_time_seconds.is_some() {
        into.progress_out_time_seconds = newer.progress_out_time_seconds;
    }
    if newer.progress_speed.is_some() {
        into.progress_speed = newer.progress_speed;
    }
    if newer.progress_updated_at_ms.is_some() {
        into.progress_updated_at_ms = newer.progress_updated_at_ms;
    }
    if newer.progress_epoch.is_some() {
        into.progress_epoch = newer.progress_epoch;
    }
    if newer.elapsed_ms.is_some() {
        into.elapsed_ms = newer.elapsed_ms;
    }
    if newer.preview_path.is_some() {
        into.preview_path = newer.preview_path;
    }
    if newer.preview_revision.is_some() {
        into.preview_revision = newer.preview_revision;
    }
}

impl PendingQueueLiteDelta {
    fn push(&mut self, delta: QueueStateLiteDelta) {
        let base = delta.base_snapshot_revision;
        if self.base_snapshot_revision.is_some_and(|prev| prev != base) {
            self.base_snapshot_revision = None;
            self.max_delta_revision = None;
            self.patches_by_id.clear();
        }

        self.base_snapshot_revision = Some(base);
        self.max_delta_revision = Some(
            self.max_delta_revision
                .map_or(delta.delta_revision, |prev| prev.max(delta.delta_revision)),
        );

        for patch in delta.patches {
            let id = patch.id.clone();
            match self.patches_by_id.get_mut(&id) {
                Some(existing) => {
                    if existing.delta_revision > delta.delta_revision {
                        continue;
                    }
                    existing.delta_revision = delta.delta_revision;
                    merge_queue_state_lite_delta_patch(&mut existing.patch, patch);
                }
                None => {
                    self.patches_by_id.insert(
                        id,
                        QueueStateLiteDeltaPatchEntry {
                            delta_revision: delta.delta_revision,
                            patch,
                        },
                    );
                }
            }
        }
    }

    fn take_coalesced(&mut self) -> Option<QueueStateLiteDelta> {
        let base = self.base_snapshot_revision?;
        let max_rev = self.max_delta_revision?;
        if self.patches_by_id.is_empty() {
            return None;
        }

        let patches = self
            .patches_by_id
            .drain()
            .map(|(_, entry)| entry.patch)
            .collect::<Vec<_>>();

        self.base_snapshot_revision = None;
        self.max_delta_revision = None;

        Some(QueueStateLiteDelta {
            base_snapshot_revision: base,
            delta_revision: max_rev,
            patches,
        })
    }
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
    let pending_delta: Arc<Mutex<PendingQueueLiteDelta>> =
        Arc::new(Mutex::new(PendingQueueLiteDelta::default()));
    let delta_worker_running = Arc::new(AtomicBool::new(false));

    const EMIT_MIN_INTERVAL_MS: u64 = 50;
    let delta_emit_ms = delta_emit_interval_ms();

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
                let ui_lite = QueueStateUiLite::from(&lite);
                if let Err(err) = event_handle.emit("ffui://queue-state-lite", &ui_lite) {
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

    let event_handle = handle.clone();
    engine.register_queue_lite_delta_listener(move |delta: QueueStateLiteDelta| {
        {
            let mut pending = pending_delta.lock().unwrap_or_else(|e| e.into_inner());
            pending.push(delta);
        }

        if delta_worker_running.swap(true, Ordering::AcqRel) {
            return;
        }

        let pending_delta = pending_delta.clone();
        let delta_worker_running = delta_worker_running.clone();
        let event_handle = event_handle.clone();
        let delta_emit_ms = delta_emit_ms;

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let next = {
                    let mut pending = pending_delta.lock().unwrap_or_else(|e| e.into_inner());
                    pending.take_coalesced()
                };

                let Some(delta) = next else {
                    delta_worker_running.store(false, Ordering::Release);
                    let has_pending = {
                        let pending = pending_delta.lock().unwrap_or_else(|e| e.into_inner());
                        !pending.patches_by_id.is_empty()
                    };
                    if has_pending && !delta_worker_running.swap(true, Ordering::AcqRel) {
                        continue;
                    }
                    break;
                };

                if let Err(err) = event_handle.emit("ffui://queue-state-lite-delta", &delta) {
                    crate::debug_eprintln!("failed to emit queue-state-lite-delta event: {err}");
                }

                std::thread::sleep(Duration::from_millis(delta_emit_ms));
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_lite_delta(
        base_snapshot_revision: u64,
        delta_revision: u64,
        job_id: &str,
        progress: f64,
    ) -> QueueStateLiteDelta {
        QueueStateLiteDelta {
            base_snapshot_revision,
            delta_revision,
            patches: vec![crate::ffui_core::TranscodeJobLiteDeltaPatch {
                id: job_id.to_string(),
                status: None,
                progress: Some(progress),
                progress_out_time_seconds: None,
                progress_speed: None,
                progress_updated_at_ms: None,
                progress_epoch: None,
                elapsed_ms: None,
                preview_path: None,
                preview_revision: None,
            }],
        }
    }

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

    #[test]
    fn pending_queue_lite_delta_coalesces_patches_by_job_id() {
        let mut pending = PendingQueueLiteDelta::default();

        pending.push(make_lite_delta(10, 1, "job-1", 1.0));
        pending.push(make_lite_delta(10, 2, "job-2", 2.0));
        pending.push(make_lite_delta(10, 3, "job-1", 3.0));

        let coalesced = pending.take_coalesced().expect("should emit a delta");
        assert_eq!(coalesced.base_snapshot_revision, 10);
        assert_eq!(coalesced.delta_revision, 3);

        let mut by_id = HashMap::<String, f64>::new();
        for patch in coalesced.patches {
            by_id.insert(patch.id.clone(), patch.progress.unwrap_or_default());
        }
        assert_eq!(by_id.get("job-1").copied(), Some(3.0));
        assert_eq!(by_id.get("job-2").copied(), Some(2.0));
        assert_eq!(by_id.len(), 2);
    }

    #[test]
    fn pending_queue_lite_delta_merges_sparse_patches_in_revision_order() {
        let mut pending = PendingQueueLiteDelta::default();

        pending.push(QueueStateLiteDelta {
            base_snapshot_revision: 10,
            delta_revision: 1,
            patches: vec![crate::ffui_core::TranscodeJobLiteDeltaPatch {
                id: "job-1".to_string(),
                status: Some(crate::ffui_core::JobStatus::Paused),
                progress: Some(10.0),
                progress_out_time_seconds: None,
                progress_speed: None,
                progress_updated_at_ms: None,
                progress_epoch: None,
                elapsed_ms: None,
                preview_path: None,
                preview_revision: None,
            }],
        });

        // A later patch may update preview fields only; coalescing must not
        // drop earlier progress/status fields for the same job id.
        pending.push(QueueStateLiteDelta {
            base_snapshot_revision: 10,
            delta_revision: 2,
            patches: vec![crate::ffui_core::TranscodeJobLiteDeltaPatch {
                id: "job-1".to_string(),
                status: None,
                progress: None,
                progress_out_time_seconds: None,
                progress_speed: None,
                progress_updated_at_ms: None,
                progress_epoch: None,
                elapsed_ms: None,
                preview_path: Some("C:/previews/job-1.jpg".to_string()),
                preview_revision: Some(5),
            }],
        });

        let coalesced = pending.take_coalesced().expect("should emit a delta");
        let patch = coalesced
            .patches
            .iter()
            .find(|p| p.id == "job-1")
            .expect("expected job-1 patch");
        assert_eq!(patch.status, Some(crate::ffui_core::JobStatus::Paused));
        assert_eq!(patch.progress, Some(10.0));
        assert_eq!(patch.preview_path.as_deref(), Some("C:/previews/job-1.jpg"));
        assert_eq!(patch.preview_revision, Some(5));
    }

    #[test]
    fn pending_queue_lite_delta_resets_on_base_snapshot_change() {
        let mut pending = PendingQueueLiteDelta::default();

        pending.push(make_lite_delta(10, 1, "job-1", 1.0));
        pending.push(make_lite_delta(11, 1, "job-2", 2.0));

        let coalesced = pending.take_coalesced().expect("should emit a delta");
        assert_eq!(coalesced.base_snapshot_revision, 11);
        assert_eq!(coalesced.patches.len(), 1);
        assert_eq!(coalesced.patches[0].id, "job-2");
    }

    #[test]
    fn delta_emit_interval_ms_respects_env_override_and_ignores_invalid_values() {
        let _env_guard = crate::test_support::env_lock();
        let _vars_guard =
            crate::test_support::EnvVarGuard::capture(["FFUI_QUEUE_STATE_DELTA_EMIT_MS"]);

        crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "123");
        assert_eq!(delta_emit_interval_ms(), 123);

        crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "0");
        let default_ms = if cfg!(debug_assertions) { 50 } else { 100 };
        assert_eq!(delta_emit_interval_ms(), default_ms);

        crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "nope");
        assert_eq!(delta_emit_interval_ms(), default_ms);
    }
}
