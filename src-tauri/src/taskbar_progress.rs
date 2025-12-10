use crate::ffui_core::{
    JobStatus, QueueState, TaskbarProgressMode, TaskbarProgressScope, TranscodeJob,
};

fn is_terminal(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

fn normalized_job_progress(job: &TranscodeJob) -> f64 {
    if is_terminal(&job.status) {
        1.0
    } else {
        match job.status {
            JobStatus::Processing | JobStatus::Paused => (job.progress.clamp(0.0, 100.0)) / 100.0,
            JobStatus::Waiting | JobStatus::Queued => 0.0,
            _ => 0.0,
        }
    }
}

fn job_weight(job: &TranscodeJob, mode: TaskbarProgressMode) -> f64 {
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
                // Roughly assume ~8 Mbps (≈1 MB/s) as a generic bitrate so
                // larger files are treated as taking proportionally longer.
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

    // Ensure every job contributes at least a tiny positive weight so we
    // never divide by zero when jobs are present.
    weight.max(1.0e-3)
}

/// Compute an application-level progress value for the Windows taskbar based on
/// the current queue state and the configured aggregation mode. The returned
/// value is in the range [0.0, 1.0] when progress should be shown, or `None`
/// when the taskbar progress bar should be cleared.
pub fn compute_taskbar_progress(
    state: &QueueState,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) -> Option<f64> {
    if state.jobs.is_empty() {
        return None;
    }

    let has_non_terminal = state.jobs.iter().any(|job| !is_terminal(&job.status));

    let mut weighted_total = 0.0f64;
    let mut total_weight = 0.0f64;

    let use_non_terminal_only = scope == TaskbarProgressScope::ActiveAndQueued && has_non_terminal;

    if use_non_terminal_only {
        for job in state.jobs.iter().filter(|job| !is_terminal(&job.status)) {
            let w = job_weight(job, mode);
            let p = normalized_job_progress(job);
            weighted_total += w * p;
            total_weight += w;
        }
    } else {
        for job in &state.jobs {
            let w = job_weight(job, mode);
            let p = normalized_job_progress(job);
            weighted_total += w * p;
            total_weight += w;
        }
    }

    if total_weight <= 0.0 {
        return None;
    }

    Some((weighted_total / total_weight).clamp(0.0, 1.0))
}

/// Returns true when all jobs in the queue are in a terminal state
/// (completed/failed/skipped/cancelled) and the queue is non-empty.
fn is_terminal_only_queue(state: &QueueState) -> bool {
    if state.jobs.is_empty() {
        return false;
    }

    state.jobs.iter().all(|job| is_terminal(&job.status))
}

/// Update the Windows taskbar progress bar for the main window. On non-Windows
/// platforms this is a no-op so the rest of the app remains portable.
#[cfg(windows)]
pub fn update_taskbar_progress(
    app: &tauri::AppHandle,
    state: &QueueState,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    use tauri::{Manager, UserAttentionType};

    if let Some(window) = app.get_webview_window("main") {
        let completed_queue = is_terminal_only_queue(state);

        match compute_taskbar_progress(state, mode, scope) {
            Some(progress) => {
                let pct = (progress * 100.0).round().clamp(0.0, 100.0) as u64;

                // 队列全部进入终态且聚合进度为 100% 时，我们需要一个“完成提醒”而不是
                // “卡住的绿色进度条”。如果此时窗口不在前台：使用黄色暂停条 + 闪烁；
                // 如果此时用户本来就在窗口内：直接清除进度，不再强制用户切出/再切回来。
                let is_completed_bar = completed_queue && (progress - 1.0).abs() < f64::EPSILON;

                if is_completed_bar {
                    let is_focused = window.is_focused().unwrap_or(false);

                    if is_focused {
                        // 用户已经在应用里，直接清空任务栏进度，不再额外打扰。
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
                        // 应用在后台：显示黄色暂停条并请求用户注意，让任务栏图标闪烁。
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
                    // 正在进行中的情况保持绿色 Normal 进度条。
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
                // Clear the taskbar progress indicator.
                let state = ProgressBarState {
                    // Use the dedicated "None" status so the underlying
                    // runtime maps this to TBPF_NOPROGRESS on Windows and
                    // actually hides the overlay instead of just leaving the
                    // last value in place.
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
pub fn update_taskbar_progress(
    _app: &tauri::AppHandle,
    _state: &QueueState,
    _mode: TaskbarProgressMode,
    _scope: TaskbarProgressScope,
) {
    // No-op on non-Windows platforms.
}

/// Clear the Windows taskbar progress bar if the aggregated queue progress
/// represents a completed run (100%). This is used as an explicit acknowledgement
/// path when the user clicks the app icon / focuses the window after all work
/// has finished.
#[cfg(windows)]
pub fn acknowledge_taskbar_completion(
    app: &tauri::AppHandle,
    state: &QueueState,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) {
    use tauri::Manager;
    use tauri::window::{ProgressBarState, ProgressBarStatus};

    // Only clear when the logical taskbar progress is a completed bar.
    if let Some(progress) = compute_taskbar_progress(state, mode, scope) {
        if (progress - 1.0).abs() > f64::EPSILON {
            return;
        }
    } else {
        // Nothing to clear if the engine considers the bar already hidden.
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let state = ProgressBarState {
            // Explicitly hide the bar instead of relying on the previous
            // status. This makes "click once to dismiss" behaviour reliable.
            status: Some(ProgressBarStatus::None),
            progress: None,
        };
        if let Err(err) = window.set_progress_bar(state) {
            eprintln!("failed to clear Windows taskbar progress on acknowledge: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::{JobSource, JobType, TranscodeJob};

    fn make_job(id: &str, status: JobStatus, progress: f64) -> TranscodeJob {
        TranscodeJob {
            id: id.to_string(),
            filename: format!("{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 100.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status,
            progress,
            start_time: Some(0),
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: None,
            output_path: None,
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: None,
            wait_metadata: None,
        }
    }

    #[test]
    fn no_jobs_clears_progress() {
        let state = QueueState { jobs: Vec::new() };
        assert_eq!(
            compute_taskbar_progress(
                &state,
                TaskbarProgressMode::BySize,
                TaskbarProgressScope::AllJobs
            ),
            None
        );
    }

    #[test]
    fn processing_job_maps_progress_to_unit_interval() {
        let state = QueueState {
            jobs: vec![make_job("1", JobStatus::Processing, 50.0)],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress expected");
        assert!((progress - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn multiple_processing_jobs_use_average_progress() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Processing, 25.0),
                make_job("2", JobStatus::Processing, 75.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress expected");
        // Average of 25% and 75% is 50%.
        assert!((progress - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn pending_jobs_without_processing_show_zero_progress() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Waiting, 0.0),
                make_job("2", JobStatus::Queued, 0.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress expected");
        assert_eq!(progress, 0.0);
    }

    #[test]
    fn terminal_only_jobs_show_completed_bar() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Failed, 100.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress expected");
        assert!((progress - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn active_scope_excludes_terminal_jobs_when_non_terminal_present() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Failed, 100.0),
                make_job("3", JobStatus::Waiting, 0.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");
        assert_eq!(
            progress, 0.0,
            "active scope should ignore terminal jobs when non-terminal jobs exist"
        );
    }

    #[test]
    fn active_scope_falls_back_to_all_jobs_when_queue_completed() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Failed, 100.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");
        assert!(
            (progress - 1.0).abs() < f64::EPSILON,
            "even in active scope a fully completed queue should report 100%"
        );
    }

    #[test]
    fn terminal_only_queue_detector_matches_completed_bar_state() {
        let state = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Failed, 100.0),
            ],
        };

        assert!(is_terminal_only_queue(&state));

        let mixed = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Processing, 50.0),
            ],
        };

        assert!(!is_terminal_only_queue(&mixed));
    }

    #[test]
    fn aggregated_progress_does_not_decrease_when_job_completes() {
        let before = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Processing, 80.0),
                make_job("2", JobStatus::Processing, 20.0),
            ],
        };

        let after = QueueState {
            jobs: vec![
                make_job("1", JobStatus::Completed, 100.0),
                make_job("2", JobStatus::Processing, 20.0),
            ],
        };

        let p_before = compute_taskbar_progress(
            &before,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress");
        let p_after = compute_taskbar_progress(
            &after,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress");

        assert!(
            p_after + f64::EPSILON >= p_before,
            "aggregated progress must not go backwards when a job completes (before {p_before}, after {p_after})"
        );
    }
}
