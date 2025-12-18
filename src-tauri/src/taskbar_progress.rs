use crate::ffui_core::{
    JobStatus,
    QueueState,
    TaskbarProgressMode,
    TaskbarProgressScope,
    TranscodeJob,
};

mod lite;

pub use lite::update_taskbar_progress_lite;

fn is_terminal(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

fn cohort_start_ms_for_active_scope(state: &QueueState) -> Option<u64> {
    state
        .jobs
        .iter()
        .filter(|job| !is_terminal(&job.status))
        .filter_map(|job| job.start_time)
        .min()
}

fn eligible_jobs_for_scope<'a>(
    state: &'a QueueState,
    scope: TaskbarProgressScope,
) -> Box<dyn Iterator<Item = &'a TranscodeJob> + 'a> {
    match scope {
        TaskbarProgressScope::AllJobs => Box::new(state.jobs.iter()),
        TaskbarProgressScope::ActiveAndQueued => {
            let has_non_terminal = state.jobs.iter().any(|job| !is_terminal(&job.status));
            if !has_non_terminal {
                // Fall back to AllJobs so a completed queue still reports 100%.
                return Box::new(state.jobs.iter());
            }

            let cohort_start_ms = cohort_start_ms_for_active_scope(state);
            Box::new(state.jobs.iter().filter(move |job| {
                if !is_terminal(&job.status) {
                    return true;
                }
                // Only count terminal jobs that belong to the same enqueue cohort
                // as the currently active/waiting jobs. This prevents progress
                // from resetting to 0% between serial tasks (including composite
                // Smart Scan batches) while still ignoring older completed jobs
                // when a new round of work starts.
                match cohort_start_ms {
                    Some(start_ms) => job.start_time.map(|t| t >= start_ms).unwrap_or(false),
                    None => false,
                }
            }))
        }
    }
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

    let mut weighted_total = 0.0f64;
    let mut total_weight = 0.0f64;

    for job in eligible_jobs_for_scope(state, scope) {
        let w = job_weight(job, mode);
        let p = normalized_job_progress(job);
        weighted_total += w * p;
        total_weight += w;
    }

    if total_weight <= 0.0 {
        return None;
    }

    Some((weighted_total / total_weight).clamp(0.0, 1.0))
}

/// Returns true when all jobs in the queue are in a terminal state
/// (completed/failed/skipped/cancelled) and the queue is non-empty.
#[cfg(test)]
fn is_terminal_only_queue(state: &QueueState) -> bool {
    if state.jobs.is_empty() {
        return false;
    }

    state.jobs.iter().all(|job| is_terminal(&job.status))
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
    use tauri::window::{
        ProgressBarState,
        ProgressBarStatus,
    };

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
    use crate::ffui_core::{
        JobSource,
        JobType,
        TranscodeJob,
    };

    fn make_job(id: &str, status: JobStatus, progress: f64) -> TranscodeJob {
        make_job_with_start(id, status, progress, Some(0))
    }

    fn make_job_with_start(
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
            original_size_mb: 100.0,
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
                make_job_with_start("1", JobStatus::Completed, 100.0, Some(1)),
                make_job_with_start("2", JobStatus::Failed, 100.0, Some(1)),
                // New cohort (e.g. a fresh queue run) starts after the earlier jobs.
                make_job_with_start("3", JobStatus::Waiting, 0.0, Some(10)),
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
            "active scope should ignore terminal jobs from an earlier cohort when new work starts"
        );
    }

    #[test]
    fn active_scope_counts_terminal_jobs_from_same_cohort_to_avoid_resets() {
        let state = QueueState {
            jobs: vec![
                make_job_with_start("1", JobStatus::Completed, 100.0, Some(10)),
                make_job_with_start("2", JobStatus::Waiting, 0.0, Some(10)),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");

        assert!(
            (progress - 0.5).abs() < f64::EPSILON,
            "serial queues should not reset progress to 0% between tasks (got {progress})"
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
