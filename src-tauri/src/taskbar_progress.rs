use crate::ffui_core::{
    JobStatus, QueueState, TaskbarProgressMode, TaskbarProgressScope, TranscodeJob,
};

mod lite;

pub use lite::update_taskbar_progress_lite;

const fn is_terminal(status: &JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
    )
}

pub trait JobProgressModel {
    fn status(&self) -> &JobStatus;
    fn progress_percent(&self) -> f64;
    fn start_time_ms(&self) -> Option<u64>;
    fn size_mb(&self) -> f64;
    fn duration_seconds(&self) -> f64;
    fn estimated_seconds(&self) -> Option<f64>;
}

impl JobProgressModel for TranscodeJob {
    fn status(&self) -> &JobStatus {
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

fn cohort_start_ms_for_active_scope_generic<J: JobProgressModel>(jobs: &[J]) -> Option<u64> {
    jobs.iter()
        .filter(|job| !is_terminal(job.status()))
        .filter_map(JobProgressModel::start_time_ms)
        .min()
}

fn eligible_jobs_for_scope_generic<'a, J: JobProgressModel>(
    jobs: &'a [J],
    scope: TaskbarProgressScope,
) -> Box<dyn Iterator<Item = &'a J> + 'a> {
    match scope {
        TaskbarProgressScope::AllJobs => Box::new(jobs.iter()),
        TaskbarProgressScope::ActiveAndQueued => {
            let has_non_terminal = jobs.iter().any(|job| !is_terminal(job.status()));
            if !has_non_terminal {
                return Box::new(jobs.iter());
            }

            let cohort_start_ms = cohort_start_ms_for_active_scope_generic(jobs);
            Box::new(jobs.iter().filter(move |job| {
                if !is_terminal(job.status()) {
                    return true;
                }
                cohort_start_ms
                    .is_some_and(|start_ms| job.start_time_ms().is_some_and(|t| t >= start_ms))
            }))
        }
    }
}

fn normalized_job_progress_generic<J: JobProgressModel>(job: &J) -> f64 {
    if is_terminal(job.status()) {
        1.0
    } else {
        match job.status() {
            JobStatus::Processing | JobStatus::Paused => {
                (job.progress_percent().clamp(0.0, 100.0)) / 100.0
            }
            _ => 0.0,
        }
    }
}

fn job_weight_generic<J: JobProgressModel>(job: &J, mode: TaskbarProgressMode) -> f64 {
    let size_mb = job.size_mb().max(0.0);
    let duration_seconds = job.duration_seconds().max(0.0);
    let estimated_seconds = job.estimated_seconds().unwrap_or(0.0);

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

pub fn compute_taskbar_progress_generic<J: JobProgressModel>(
    jobs: &[J],
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) -> Option<f64> {
    if jobs.is_empty() {
        return None;
    }

    let mut weighted_total = 0.0f64;
    let mut total_weight = 0.0f64;

    for job in eligible_jobs_for_scope_generic(jobs, scope) {
        let w = job_weight_generic(job, mode);
        let p = normalized_job_progress_generic(job);
        weighted_total += w * p;
        total_weight += w;
    }

    if total_weight <= 0.0 {
        return None;
    }

    Some((weighted_total / total_weight).clamp(0.0, 1.0))
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
    compute_taskbar_progress_generic(&state.jobs, mode, scope)
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
            crate::debug_eprintln!(
                "failed to clear Windows taskbar progress on acknowledge: {err}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::TranscodeJob;

    fn make_job(id: &str, status: JobStatus, progress: f64) -> TranscodeJob {
        make_job_with_start(id, status, progress, Some(0))
    }

    fn make_job_with_start(
        id: &str,
        status: JobStatus,
        progress: f64,
        start_time: Option<u64>,
    ) -> TranscodeJob {
        crate::test_support::make_transcode_job_for_tests(id, status, progress, start_time)
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
                make_job("1", JobStatus::Queued, 0.0),
                make_job("2", JobStatus::Queued, 0.0),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs,
        )
        .expect("progress expected");
        assert!(
            progress.abs() < f64::EPSILON,
            "pending jobs should report 0.0 progress (got {progress})"
        );
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
                make_job_with_start("3", JobStatus::Queued, 0.0, Some(10)),
            ],
        };

        let progress = compute_taskbar_progress(
            &state,
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::ActiveAndQueued,
        )
        .expect("progress expected");
        assert!(
            progress.abs() < f64::EPSILON,
            "active scope should ignore terminal jobs from an earlier cohort when new work starts"
        );
    }

    #[test]
    fn active_scope_counts_terminal_jobs_from_same_cohort_to_avoid_resets() {
        let state = QueueState {
            jobs: vec![
                make_job_with_start("1", JobStatus::Completed, 100.0, Some(10)),
                make_job_with_start("2", JobStatus::Queued, 0.0, Some(10)),
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
