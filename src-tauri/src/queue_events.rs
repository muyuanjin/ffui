use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use crate::ffui_core::TaskbarProgressDeltaTracker;
use crate::ffui_core::{QueueStateLiteDelta, QueueStateUiLite, TranscodingEngine};
#[cfg(windows)]
use tauri::UserAttentionType;
#[cfg(windows)]
use tauri::window::{ProgressBarState, ProgressBarStatus};

#[cfg(windows)]
#[derive(Debug)]
struct TaskbarDeltaUiState {
    tracker: TaskbarProgressDeltaTracker,
    last_emit_at: Option<std::time::Instant>,
    last_pct: Option<u64>,
    last_status_kind: Option<u8>,
    attention_sent_for_completion: bool,
}

#[cfg(windows)]
impl TaskbarDeltaUiState {
    fn new() -> Self {
        Self {
            tracker: TaskbarProgressDeltaTracker::default(),
            last_emit_at: None,
            last_pct: None,
            last_status_kind: None,
            attention_sent_for_completion: false,
        }
    }

    fn reset_from_snapshot(
        &mut self,
        snapshot: &QueueStateUiLite,
        mode: crate::ffui_core::TaskbarProgressMode,
        scope: crate::ffui_core::TaskbarProgressScope,
    ) {
        self.tracker.reset_from_ui_lite(snapshot, mode, scope);
        self.last_pct = None;
        self.last_status_kind = None;
        self.last_emit_at = None;
        self.attention_sent_for_completion = false;
    }

    fn apply_delta(
        &mut self,
        delta: &QueueStateLiteDelta,
        mode: crate::ffui_core::TaskbarProgressMode,
        scope: crate::ffui_core::TaskbarProgressScope,
    ) {
        self.tracker.apply_delta(delta, mode, scope);
    }

    fn ensure_base_from_latest(
        &mut self,
        latest: Option<&QueueStateUiLite>,
        base_snapshot_revision: u64,
        mode: crate::ffui_core::TaskbarProgressMode,
        scope: crate::ffui_core::TaskbarProgressScope,
    ) {
        if self.tracker.base_snapshot_revision() == Some(base_snapshot_revision) {
            return;
        }
        let Some(snapshot) = latest else {
            return;
        };
        if snapshot.snapshot_revision != base_snapshot_revision {
            return;
        }
        self.reset_from_snapshot(snapshot, mode, scope);
    }

    fn maybe_emit(&mut self, app: &AppHandle) {
        const MIN_EMIT_INTERVAL_MS: u64 = 250;
        let now = std::time::Instant::now();
        if let Some(prev) = self.last_emit_at
            && now.duration_since(prev) < std::time::Duration::from_millis(MIN_EMIT_INTERVAL_MS)
        {
            return;
        }

        let Some(window) = app.get_webview_window("main") else {
            return;
        };

        let completed_queue = self.tracker.completed_queue();
        let progress = self.tracker.progress();

        let mut desired_status: ProgressBarStatus = ProgressBarStatus::None;
        let mut desired_pct: Option<u64> = None;

        if let Some(p) = progress {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let pct = (p * 100.0).round().clamp(0.0, 100.0) as u64;
            desired_pct = Some(pct);

            let is_completed_bar = completed_queue && (p - 1.0).abs() < f64::EPSILON;
            if is_completed_bar {
                let is_focused = window.is_focused().unwrap_or(false);
                if is_focused {
                    desired_status = ProgressBarStatus::None;
                    desired_pct = None;
                    self.attention_sent_for_completion = false;
                } else {
                    desired_status = ProgressBarStatus::Paused;
                    if !self.attention_sent_for_completion {
                        self.attention_sent_for_completion = true;
                        drop(window.request_user_attention(Some(UserAttentionType::Critical)));
                    }
                }
            } else {
                desired_status = ProgressBarStatus::Normal;
                self.attention_sent_for_completion = false;
            }
        } else {
            self.attention_sent_for_completion = false;
        }

        let desired_kind: u8 = match desired_status {
            ProgressBarStatus::None => 0,
            ProgressBarStatus::Normal => 1,
            ProgressBarStatus::Indeterminate => 2,
            ProgressBarStatus::Paused => 3,
            ProgressBarStatus::Error => 4,
        };

        if self.last_status_kind == Some(desired_kind) && self.last_pct == desired_pct {
            self.last_emit_at = Some(now);
            return;
        }

        let state = ProgressBarState {
            status: Some(desired_status),
            progress: desired_pct,
        };
        if let Err(err) = window.set_progress_bar(state) {
            crate::debug_eprintln!("failed to set Windows taskbar progress: {err}");
        }
        self.last_status_kind = Some(desired_kind);
        self.last_pct = desired_pct;
        self.last_emit_at = Some(now);
    }
}

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
    let pending_lite: Arc<Mutex<Option<QueueStateUiLite>>> = Arc::new(Mutex::new(None));
    let latest_ui_lite_for_taskbar: Arc<Mutex<Option<QueueStateUiLite>>> =
        Arc::new(Mutex::new(None));
    #[cfg(windows)]
    let taskbar_delta_ui_state: Arc<Mutex<TaskbarDeltaUiState>> =
        Arc::new(Mutex::new(TaskbarDeltaUiState::new()));
    let worker_running = Arc::new(AtomicBool::new(false));
    let pending_delta: Arc<Mutex<PendingQueueLiteDelta>> =
        Arc::new(Mutex::new(PendingQueueLiteDelta::default()));
    let delta_worker_running = Arc::new(AtomicBool::new(false));

    const EMIT_MIN_INTERVAL_MS: u64 = 50;
    let delta_emit_ms = delta_emit_interval_ms();

    let latest_ui_lite_for_taskbar_for_ui = latest_ui_lite_for_taskbar.clone();
    #[cfg(windows)]
    let taskbar_delta_ui_state_for_ui = taskbar_delta_ui_state.clone();
    engine.register_queue_ui_lite_listener(move |state: QueueStateUiLite| {
        {
            let mut pending = pending_lite.lock().unwrap_or_else(|e| e.into_inner());
            *pending = Some(state);
        }

        if worker_running.swap(true, Ordering::AcqRel) {
            return;
        }

        let pending_lite = pending_lite.clone();
        let latest_ui_lite_for_taskbar = latest_ui_lite_for_taskbar_for_ui.clone();
        let worker_running = worker_running.clone();
        let event_handle = event_handle.clone();
        let taskbar_handle = taskbar_handle.clone();
        #[cfg(windows)]
        let taskbar_delta_ui_state = taskbar_delta_ui_state_for_ui.clone();

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let next = {
                    let mut pending = pending_lite.lock().unwrap_or_else(|e| e.into_inner());
                    pending.take()
                };

                let Some(ui_lite) = next else {
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

                {
                    let mut latest = latest_ui_lite_for_taskbar
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    *latest = Some(ui_lite.clone());
                }

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
                if let Err(err) = event_handle.emit("ffui://queue-state-lite", &ui_lite) {
                    crate::debug_eprintln!("failed to emit queue-state-lite event: {err}");
                }

                #[cfg(windows)]
                {
                    let engine = taskbar_handle.state::<TranscodingEngine>();
                    let settings = engine.settings();
                    let mut ui = taskbar_delta_ui_state
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    ui.reset_from_snapshot(
                        &ui_lite,
                        settings.taskbar_progress_mode,
                        settings.taskbar_progress_scope,
                    );
                    ui.maybe_emit(&taskbar_handle);
                }

                std::thread::sleep(Duration::from_millis(EMIT_MIN_INTERVAL_MS));
            }
        });
    });

    let event_handle = handle.clone();
    #[cfg(windows)]
    let taskbar_delta_handle = handle.clone();
    #[cfg(windows)]
    let latest_ui_lite_for_taskbar = latest_ui_lite_for_taskbar.clone();
    #[cfg(windows)]
    let taskbar_delta_ui_state_for_delta = taskbar_delta_ui_state.clone();
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
        #[cfg(windows)]
        let taskbar_delta_handle = taskbar_delta_handle.clone();
        #[cfg(windows)]
        let latest_ui_lite_for_taskbar = latest_ui_lite_for_taskbar.clone();
        #[cfg(windows)]
        let taskbar_delta_ui_state = taskbar_delta_ui_state_for_delta.clone();
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

                #[cfg(windows)]
                {
                    let engine = taskbar_delta_handle.state::<TranscodingEngine>();
                    let settings = engine.settings();
                    let latest = latest_ui_lite_for_taskbar
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    let mut ui = taskbar_delta_ui_state
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    ui.ensure_base_from_latest(
                        latest.as_ref(),
                        delta.base_snapshot_revision,
                        settings.taskbar_progress_mode,
                        settings.taskbar_progress_scope,
                    );
                    ui.apply_delta(
                        &delta,
                        settings.taskbar_progress_mode,
                        settings.taskbar_progress_scope,
                    );
                    ui.maybe_emit(&taskbar_delta_handle);
                }

                std::thread::sleep(Duration::from_millis(delta_emit_ms));
            }
        });
    });
}

#[cfg(test)]
mod tests;
