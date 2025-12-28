use super::*;
use crate::ffui_core::domain::{JobSource, JobType, TranscodeJobUiLite};

fn make_job(
    id: &str,
    status: JobStatus,
    progress: f64,
    start_time: Option<u64>,
) -> TranscodeJobUiLite {
    TranscodeJobUiLite {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 1.0,
        original_codec: None,
        preset_id: "p1".to_string(),
        status,
        wait_request_pending: false,
        progress,
        start_time,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        input_path: None,
        created_time_ms: None,
        modified_time_ms: None,
        output_path: None,
        output_policy: None,
        ffmpeg_command: None,
        first_run_command: None,
        first_run_started_at_ms: None,
        skip_reason: None,
        media_info: None,
        estimated_seconds: None,
        preview_path: None,
        preview_revision: 0,
        log_tail: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: None,
        wait_metadata: None,
    }
}

fn make_snapshot(rev: u64, jobs: Vec<TranscodeJobUiLite>) -> QueueStateUiLite {
    QueueStateUiLite {
        snapshot_revision: rev,
        jobs,
    }
}

fn make_delta(
    base: u64,
    delta_rev: u64,
    patches: Vec<crate::ffui_core::TranscodeJobLiteDeltaPatch>,
) -> QueueStateLiteDelta {
    QueueStateLiteDelta {
        base_snapshot_revision: base,
        delta_revision: delta_rev,
        patches,
    }
}

fn patch_progress(id: &str, progress: f64) -> crate::ffui_core::TranscodeJobLiteDeltaPatch {
    crate::ffui_core::TranscodeJobLiteDeltaPatch {
        id: id.to_string(),
        status: None,
        progress: Some(progress),
        progress_out_time_seconds: None,
        progress_speed: None,
        progress_updated_at_ms: None,
        progress_epoch: None,
        elapsed_ms: None,
        preview_path: None,
        preview_revision: None,
    }
}

fn patch_status(id: &str, status: JobStatus) -> crate::ffui_core::TranscodeJobLiteDeltaPatch {
    crate::ffui_core::TranscodeJobLiteDeltaPatch {
        id: id.to_string(),
        status: Some(status),
        progress: None,
        progress_out_time_seconds: None,
        progress_speed: None,
        progress_updated_at_ms: None,
        progress_epoch: None,
        elapsed_ms: None,
        preview_path: None,
        preview_revision: None,
    }
}

#[test]
fn progress_updates_do_not_force_full_rebuild_in_all_jobs_scope() {
    let snapshot = make_snapshot(
        1,
        vec![
            make_job("a", JobStatus::Processing, 10.0, Some(10)),
            make_job("b", JobStatus::Queued, 0.0, Some(10)),
            make_job("c", JobStatus::Completed, 100.0, Some(1)),
        ],
    );
    let mut tracker = TaskbarProgressDeltaTracker::default();
    tracker.reset_from_ui_lite(
        &snapshot,
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::AllJobs,
    );
    let rebuilds = tracker.full_rebuilds_for_tests();

    let delta = make_delta(1, 1, vec![patch_progress("a", 20.0)]);
    tracker.apply_delta(
        &delta,
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::AllJobs,
    );

    assert_eq!(
        tracker.full_rebuilds_for_tests(),
        rebuilds,
        "progress-only delta should not rebuild totals"
    );
    let p = tracker.progress().expect("progress");
    // weights are equal (1.0), progress = (0.2 + 0.0 + 1.0) / 3
    assert!((p - (1.2 / 3.0)).abs() < 1.0e-9);
}

#[test]
fn active_scope_rebuilds_only_when_cohort_membership_changes_globally() {
    let snapshot = make_snapshot(
        7,
        vec![
            make_job("old", JobStatus::Completed, 100.0, Some(1)),
            make_job("run", JobStatus::Processing, 10.0, Some(10)),
            make_job("queued", JobStatus::Queued, 0.0, Some(10)),
        ],
    );
    let mut tracker = TaskbarProgressDeltaTracker::default();
    tracker.reset_from_ui_lite(
        &snapshot,
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::ActiveAndQueued,
    );
    let rebuilds = tracker.full_rebuilds_for_tests();

    // Processing -> completed (still has non-terminal queued job), should be incremental.
    let delta1 = make_delta(7, 1, vec![patch_status("run", JobStatus::Completed)]);
    tracker.apply_delta(
        &delta1,
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::ActiveAndQueued,
    );
    assert_eq!(
        tracker.full_rebuilds_for_tests(),
        rebuilds,
        "single job terminal transition with remaining non-terminal jobs should be incremental"
    );

    // Now queued -> completed, non-terminal count drops to 0 => scope flips to all jobs, requires rebuild.
    let delta2 = make_delta(7, 2, vec![patch_status("queued", JobStatus::Completed)]);
    tracker.apply_delta(
        &delta2,
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::ActiveAndQueued,
    );
    assert!(
        tracker.full_rebuilds_for_tests() > rebuilds,
        "when non-terminal cohort disappears, active scope eligibility changes globally"
    );
}
