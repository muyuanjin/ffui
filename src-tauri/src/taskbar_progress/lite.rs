use crate::ffui_core::{
    QueueStateLite, TaskbarProgressMode, TaskbarProgressScope, TranscodeJobLite,
};

// jscpd:ignore-start
impl super::JobProgressModel for TranscodeJobLite {
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

fn compute_taskbar_progress_lite(
    state: &QueueStateLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) -> Option<f64> {
    super::compute_taskbar_progress_generic(&state.jobs, mode, scope)
}

/// Update the Windows taskbar progress bar using the lite queue snapshot.
#[cfg(windows)]
pub fn update_taskbar_progress_lite(
    app: &tauri::AppHandle,
    state: &QueueStateLite,
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
) {
    let completed_queue =
        state.jobs.iter().all(|job| super::is_terminal(&job.status)) && !state.jobs.is_empty();
    let progress = compute_taskbar_progress_lite(state, mode, scope);
    super::update_windows_taskbar_progress_bar(app, progress, completed_queue);
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
    use crate::ffui_core::{JobStatus, QueueState, TranscodeJob};

    fn make_full_job_with_start(
        id: &str,
        status: JobStatus,
        progress: f64,
        start_time: Option<u64>,
    ) -> TranscodeJob {
        let mut job =
            crate::test_support::make_transcode_job_for_tests(id, status, progress, start_time);
        job.original_codec = Some("h264".to_string());
        job
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

        assert!(
            progress.abs() < f64::EPSILON,
            "active scope should ignore terminal jobs from an earlier cohort (got {progress})"
        );
    }
}
