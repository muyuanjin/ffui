use crate::ffui_core::{
    JobStatus, QueueStateLite, TaskbarProgressMode, TaskbarProgressScope, TranscodeJobLite,
};

fn normalized_job_progress_lite(job: &TranscodeJobLite) -> f64 {
    if super::is_terminal(&job.status) {
        1.0
    } else {
        match job.status {
            JobStatus::Processing | JobStatus::Paused => (job.progress.clamp(0.0, 100.0)) / 100.0,
            JobStatus::Waiting | JobStatus::Queued => 0.0,
            _ => 0.0,
        }
    }
}

fn job_weight_lite(job: &TranscodeJobLite, mode: TaskbarProgressMode) -> f64 {
    let size_mb = job
        .media_info
        .as_ref()
        .and_then(|m| m.size_mb)
        .unwrap_or(job.original_size_mb)
        .max(0.0);

    let duration_seconds = job
        .media_info
        .as_ref()
        .and_then(|m| m.duration_seconds)
        .unwrap_or(0.0);

    let estimated_seconds = job.estimated_seconds.unwrap_or(0.0);

    let weight = match mode {
        TaskbarProgressMode::BySize => {
            if size_mb > 0.0 {
                size_mb
            } else {
                1.0
            }
        }
        TaskbarProgressMode::ByDuration => {
            if duration_seconds > 0.0 {
                duration_seconds
            } else if size_mb > 0.0 {
                size_mb * 8.0
            } else {
                1.0
            }
        }
        TaskbarProgressMode::ByEstimatedTime => {
            if estimated_seconds > 0.0 {
                estimated_seconds
            } else if duration_seconds > 0.0 {
                duration_seconds
            } else if size_mb > 0.0 {
                size_mb * 8.0
            } else {
                1.0
            }
        }
    };

    weight.max(1.0e-3)
}

/// Compute an application-level progress value for the Windows taskbar based on
/// the current lite queue state and the configured aggregation mode.
fn compute_taskbar_progress_lite(
    state: &QueueStateLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) -> Option<f64> {
    if state.jobs.is_empty() {
        return None;
    }

    let has_non_terminal = state
        .jobs
        .iter()
        .any(|job| !super::is_terminal(&job.status));

    let mut weighted_total = 0.0f64;
    let mut total_weight = 0.0f64;

    let use_non_terminal_only = scope == TaskbarProgressScope::ActiveAndQueued && has_non_terminal;

    if use_non_terminal_only {
        for job in state
            .jobs
            .iter()
            .filter(|job| !super::is_terminal(&job.status))
        {
            let w = job_weight_lite(job, mode);
            let p = normalized_job_progress_lite(job);
            weighted_total += w * p;
            total_weight += w;
        }
    } else {
        for job in &state.jobs {
            let w = job_weight_lite(job, mode);
            let p = normalized_job_progress_lite(job);
            weighted_total += w * p;
            total_weight += w;
        }
    }

    if total_weight <= 0.0 {
        return None;
    }

    Some((weighted_total / total_weight).clamp(0.0, 1.0))
}

/// Update the Windows taskbar progress bar using the lite queue snapshot.
#[cfg(windows)]
pub fn update_taskbar_progress_lite(
    app: &tauri::AppHandle,
    state: &QueueStateLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    use tauri::{Manager, UserAttentionType};

    if let Some(window) = app.get_webview_window("main") {
        let completed_queue =
            state.jobs.iter().all(|job| super::is_terminal(&job.status)) && !state.jobs.is_empty();

        match compute_taskbar_progress_lite(state, mode, scope) {
            Some(progress) => {
                let pct = (progress * 100.0).round().clamp(0.0, 100.0) as u64;

                let is_completed_bar = completed_queue && (progress - 1.0).abs() < f64::EPSILON;

                if is_completed_bar {
                    let is_focused = window.is_focused().unwrap_or(false);

                    if is_focused {
                        let state = ProgressBarState {
                            status: Some(ProgressBarStatus::None),
                            progress: None,
                        };
                        if let Err(err) = window.set_progress_bar(state) {
                            eprintln!(
                                "failed to clear Windows taskbar progress for focused window: {err}"
                            );
                        }
                    } else {
                        let state = ProgressBarState {
                            status: Some(ProgressBarStatus::Paused),
                            progress: Some(pct),
                        };
                        if let Err(err) = window.set_progress_bar(state) {
                            eprintln!(
                                "failed to set paused Windows taskbar progress for completed queue: {err}"
                            );
                        }

                        if let Err(err) =
                            window.request_user_attention(Some(UserAttentionType::Critical))
                        {
                            eprintln!(
                                "failed to request user attention for taskbar completion: {err}"
                            );
                        }
                    }
                } else {
                    let state = ProgressBarState {
                        status: Some(ProgressBarStatus::Normal),
                        progress: Some(pct),
                    };
                    if let Err(err) = window.set_progress_bar(state) {
                        eprintln!("failed to set Windows taskbar progress: {err}");
                    }
                }
            }
            None => {
                let state = ProgressBarState {
                    status: Some(ProgressBarStatus::None),
                    progress: None,
                };
                if let Err(err) = window.set_progress_bar(state) {
                    eprintln!("failed to clear Windows taskbar progress: {err}");
                }
            }
        }
    }
}

#[cfg(not(windows))]
pub fn update_taskbar_progress_lite(
    _app: &tauri::AppHandle,
    _state: &QueueStateLite,
    _mode: TaskbarProgressMode,
    _scope: TaskbarProgressScope,
) {
    // No-op on non-Windows platforms.
}
