use crate::ffui_core::{
    JobStatus,
    QueueStateLite,
    TaskbarProgressMode,
    TaskbarProgressScope,
    TranscodeJobLite,
};

fn cohort_start_ms_for_active_scope_lite(state: &QueueStateLite) -> Option<u64> {
    state
        .jobs
        .iter()
        .filter(|job| !super::is_terminal(&job.status))
        .filter_map(|job| job.start_time)
        .min()
}

fn eligible_jobs_for_scope_lite<'a>(
    state: &'a QueueStateLite,
    scope: TaskbarProgressScope,
) -> Box<dyn Iterator<Item = &'a TranscodeJobLite> + 'a> {
    match scope {
        TaskbarProgressScope::AllJobs => Box::new(state.jobs.iter()),
        TaskbarProgressScope::ActiveAndQueued => {
            let has_non_terminal = state
                .jobs
                .iter()
                .any(|job| !super::is_terminal(&job.status));
            if !has_non_terminal {
                // Fall back to AllJobs so a completed queue still reports 100%.
                return Box::new(state.jobs.iter());
            }

            let cohort_start_ms = cohort_start_ms_for_active_scope_lite(state);
            Box::new(state.jobs.iter().filter(move |job| {
                if !super::is_terminal(&job.status) {
                    return true;
                }
                match cohort_start_ms {
                    Some(start_ms) => job.start_time.map(|t| t >= start_ms).unwrap_or(false),
                    None => false,
                }
            }))
        }
    }
}

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

    let mut weighted_total = 0.0f64;
    let mut total_weight = 0.0f64;

    for job in eligible_jobs_for_scope_lite(state, scope) {
        let w = job_weight_lite(job, mode);
        let p = normalized_job_progress_lite(job);
        weighted_total += w * p;
        total_weight += w;
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
    use tauri::window::{
        ProgressBarState,
        ProgressBarStatus,
    };
    use tauri::{
        Manager,
        UserAttentionType,
    };

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::{
        JobSource,
        JobType,
        QueueState,
        TranscodeJob,
    };

    fn make_full_job_with_start(
        id: &str,
        status: JobStatus,
        progress: f64,
        start_time: Option<u64>,
    ) -> TranscodeJob {
        TranscodeJob {
            id: id.to_string(),
            filename: format!("{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status,
            progress,
            start_time,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: None,
            output_path: None,
            output_policy: None,
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: None,
        }
    }

    fn make_lite_state(jobs: Vec<TranscodeJob>) -> QueueStateLite {
        let full = QueueState { jobs };
        QueueStateLite::from(&full)
    }

    #[test]
    fn active_scope_counts_terminal_jobs_from_same_cohort_in_lite() {
        let state = make_lite_state(vec![
            make_full_job_with_start("1", JobStatus::Completed, 100.0, Some(10)),
            make_full_job_with_start("2", JobStatus::Processing, 0.0, Some(10)),
        ]);

        let progress = compute_taskbar_progress_lite(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");

        // (1.0 + 0.0) / 2 = 0.5
        assert!((progress - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn active_scope_ignores_terminal_jobs_from_previous_cohort_in_lite() {
        let state = make_lite_state(vec![
            make_full_job_with_start("old", JobStatus::Completed, 100.0, Some(1)),
            make_full_job_with_start("new", JobStatus::Processing, 0.0, Some(10)),
        ]);

        let progress = compute_taskbar_progress_lite(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");

        assert_eq!(progress, 0.0);
    }
}
