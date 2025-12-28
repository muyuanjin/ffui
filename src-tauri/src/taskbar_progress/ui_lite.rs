use crate::ffui_core::{
    QueueStateUiLite, TaskbarProgressMode, TaskbarProgressScope, TranscodeJobUiLite,
};

// jscpd:ignore-start
impl super::JobProgressModel for TranscodeJobUiLite {
    fn status(&self) -> &crate::ffui_core::JobStatus {
        &self.status
    }

    fn progress_percent(&self) -> f64 {
        self.progress
    }

    fn start_time_ms(&self) -> Option<u64> {
        self.start_time
    }

    fn size_mb(&self) -> f64 {
        self.media_info
            .as_ref()
            .and_then(|m| m.size_mb)
            .unwrap_or(self.original_size_mb)
    }

    fn duration_seconds(&self) -> f64 {
        self.media_info
            .as_ref()
            .and_then(|m| m.duration_seconds)
            .unwrap_or(0.0)
    }

    fn estimated_seconds(&self) -> Option<f64> {
        self.estimated_seconds
    }
}
// jscpd:ignore-end

fn compute_taskbar_progress_ui_lite(
    state: &QueueStateUiLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) -> Option<f64> {
    super::compute_taskbar_progress_generic(&state.jobs, mode, scope)
}

/// Update the Windows taskbar progress bar using the UI-lite queue snapshot.
#[cfg(windows)]
pub fn update_taskbar_progress_ui_lite(
    app: &tauri::AppHandle,
    state: &QueueStateUiLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) {
    let completed_queue =
        state.jobs.iter().all(|job| super::is_terminal(&job.status)) && !state.jobs.is_empty();
    let progress = compute_taskbar_progress_ui_lite(state, mode, scope);
    super::update_windows_taskbar_progress_bar(app, progress, completed_queue);
}

#[cfg(not(windows))]
pub fn update_taskbar_progress_ui_lite(
    _app: &tauri::AppHandle,
    _state: &QueueStateUiLite,
    _mode: TaskbarProgressMode,
    _scope: TaskbarProgressScope,
) {
    // No-op on non-Windows platforms.
}
