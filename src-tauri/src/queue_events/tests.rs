use std::collections::HashMap;

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
            telemetry: None,
            progress_out_time_seconds: None,
            progress_speed: None,
            progress_updated_at_ms: None,
            progress_epoch: None,
            elapsed_ms: None,
            preview: None,
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
            telemetry: None,
            progress_out_time_seconds: None,
            progress_speed: None,
            progress_updated_at_ms: None,
            progress_epoch: None,
            elapsed_ms: None,
            preview: None,
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
            telemetry: None,
            progress_out_time_seconds: None,
            progress_speed: None,
            progress_updated_at_ms: None,
            progress_epoch: None,
            elapsed_ms: None,
            preview: Some(crate::ffui_core::TranscodeJobLitePreviewDelta {
                preview_path: Some("C:/previews/job-1.jpg".to_string()),
                preview_revision: Some(5),
            }),
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
fn merge_queue_state_lite_delta_patch_applies_all_fields() {
    let mut into = crate::ffui_core::TranscodeJobLiteDeltaPatch {
        id: "job-1".to_string(),
        status: Some(crate::ffui_core::JobStatus::Queued),
        progress: Some(1.0),
        telemetry: Some(crate::ffui_core::TranscodeJobLiteTelemetryDelta {
            progress_epoch: Some(1),
            last_progress_out_time_seconds: Some(2.0),
            last_progress_speed: Some(1.0),
            last_progress_updated_at_ms: Some(100),
        }),
        progress_out_time_seconds: Some(2.0),
        progress_speed: Some(1.0),
        progress_updated_at_ms: Some(100),
        progress_epoch: Some(1),
        elapsed_ms: Some(50),
        preview: Some(crate::ffui_core::TranscodeJobLitePreviewDelta {
            preview_path: Some("C:/previews/old.jpg".to_string()),
            preview_revision: Some(1),
        }),
        preview_path: Some("C:/previews/old.jpg".to_string()),
        preview_revision: Some(1),
    };

    let newer = crate::ffui_core::TranscodeJobLiteDeltaPatch {
        id: "job-1".to_string(),
        status: Some(crate::ffui_core::JobStatus::Processing),
        progress: Some(9.0),
        telemetry: Some(crate::ffui_core::TranscodeJobLiteTelemetryDelta {
            progress_epoch: Some(5),
            last_progress_out_time_seconds: Some(8.0),
            last_progress_speed: Some(3.5),
            last_progress_updated_at_ms: Some(999),
        }),
        progress_out_time_seconds: Some(8.0),
        progress_speed: Some(3.5),
        progress_updated_at_ms: Some(999),
        progress_epoch: Some(5),
        elapsed_ms: Some(123),
        preview: Some(crate::ffui_core::TranscodeJobLitePreviewDelta {
            preview_path: Some("C:/previews/new.jpg".to_string()),
            preview_revision: Some(42),
        }),
        preview_path: Some("C:/previews/new.jpg".to_string()),
        preview_revision: Some(42),
    };

    merge_queue_state_lite_delta_patch(&mut into, newer);

    assert_eq!(into.status, Some(crate::ffui_core::JobStatus::Processing));
    assert_eq!(into.progress, Some(9.0));
    assert_eq!(into.progress_out_time_seconds, Some(8.0));
    assert_eq!(into.progress_speed, Some(3.5));
    assert_eq!(into.progress_updated_at_ms, Some(999));
    assert_eq!(into.progress_epoch, Some(5));
    assert_eq!(into.elapsed_ms, Some(123));
    assert_eq!(
        into.telemetry
            .as_ref()
            .and_then(|t| t.last_progress_out_time_seconds),
        Some(8.0)
    );
    assert_eq!(
        into.telemetry.as_ref().and_then(|t| t.progress_epoch),
        Some(5)
    );
    assert_eq!(into.preview_path.as_deref(), Some("C:/previews/new.jpg"));
    assert_eq!(into.preview_revision, Some(42));
    assert_eq!(
        into.preview
            .as_ref()
            .and_then(|p| p.preview_revision)
            .unwrap_or_default(),
        42
    );
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
    let _vars_guard = crate::test_support::EnvVarGuard::capture(["FFUI_QUEUE_STATE_DELTA_EMIT_MS"]);

    crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "123");
    assert_eq!(delta_emit_interval_ms(), 123);

    crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "0");
    let default_ms = if cfg!(debug_assertions) { 50 } else { 100 };
    assert_eq!(delta_emit_interval_ms(), default_ms);

    crate::test_support::set_env("FFUI_QUEUE_STATE_DELTA_EMIT_MS", "nope");
    assert_eq!(delta_emit_interval_ms(), default_ms);
}

#[cfg(windows)]
#[test]
fn taskbar_progress_delta_tracker_applies_status_and_progress_patches() {
    let snapshot = QueueStateUiLite {
        snapshot_revision: 10,
        jobs: vec![crate::ffui_core::TranscodeJobUiLite {
            id: "job-1".to_string(),
            filename: "C:/in.mp4".to_string(),
            job_type: crate::ffui_core::JobType::Video,
            source: crate::ffui_core::JobSource::Manual,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: crate::ffui_core::JobStatus::Queued,
            wait_request_pending: false,
            progress: 0.0,
            start_time: Some(0),
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
        }],
    };

    let delta = QueueStateLiteDelta {
        base_snapshot_revision: 10,
        delta_revision: 1,
        patches: vec![crate::ffui_core::TranscodeJobLiteDeltaPatch {
            id: "job-1".to_string(),
            status: Some(crate::ffui_core::JobStatus::Processing),
            progress: Some(12.5),
            telemetry: None,
            progress_out_time_seconds: None,
            progress_speed: None,
            progress_updated_at_ms: None,
            progress_epoch: None,
            elapsed_ms: Some(100),
            preview: None,
            preview_path: None,
            preview_revision: None,
        }],
    };

    let mut tracker = crate::ffui_core::TaskbarProgressDeltaTracker::default();
    tracker.reset_from_ui_lite(
        &snapshot,
        crate::ffui_core::TaskbarProgressMode::BySize,
        crate::ffui_core::TaskbarProgressScope::AllJobs,
    );
    assert!(tracker.progress().unwrap_or(0.0).abs() < f64::EPSILON);

    tracker.apply_delta(
        &delta,
        crate::ffui_core::TaskbarProgressMode::BySize,
        crate::ffui_core::TaskbarProgressScope::AllJobs,
    );
    assert!((tracker.progress().unwrap_or(0.0) - 0.125).abs() < 1.0e-9);
}
