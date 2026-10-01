use super::*;
use crate::ffui_core::{
    JobExecutionMode, JobStatus, TaskbarProgressValue, TranscodeJobLiteDeltaPatch,
    TranscodeJobLiteTelemetryDelta, TranscodeJobUiLite, WaitMetadataUiLite,
};

const MODE: TaskbarProgressMode = TaskbarProgressMode::BySize;
const SCOPE: TaskbarProgressScope = TaskbarProgressScope::AllJobs;

fn snapshot(base: u64, revision: u64, percent: Option<f64>) -> QueueStateUiLite {
    let mut job = TranscodeJobUiLite::from(&crate::test_support::make_transcode_job_for_tests(
        "audio",
        JobStatus::Processing,
        percent.unwrap_or(0.0),
        Some(0),
    ));
    job.execution_mode = Some(JobExecutionMode::Managed);
    job.wait_metadata = percent.map(|percent| WaitMetadataUiLite {
        last_progress_percent: Some(percent),
        processed_wall_millis: None,
        processed_seconds: None,
        target_seconds: None,
        progress_epoch: Some(base),
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: None,
    });
    QueueStateUiLite {
        snapshot_revision: base,
        latest_delta_revision: revision,
        jobs: vec![job],
    }
}

fn delta(base: u64, revision: u64, percent: f64) -> QueueStateLiteDelta {
    QueueStateLiteDelta {
        base_snapshot_revision: base,
        delta_revision: revision,
        patches: vec![TranscodeJobLiteDeltaPatch {
            id: "audio".into(),
            status: None,
            processing_started_ms: None,
            progress: Some(percent),
            skip_reason: None,
            telemetry: Some(TranscodeJobLiteTelemetryDelta {
                last_progress_percent: Some(percent),
                progress_epoch: Some(base),
                last_progress_out_time_seconds: Some(percent),
                last_progress_speed: None,
                last_progress_updated_at_ms: Some(0),
                last_progress_frame: None,
                phase: Default::default(),
            }),
            elapsed_ms: None,
            preview: None,
        }],
    }
}

#[test]
fn taskbar_stream_replays_ahead_zero_after_snapshot_and_ignores_stale_resets() {
    let mut stream = TaskbarProgressStream::default();
    assert!(stream.snapshot(&snapshot(2, 0, None), MODE, SCOPE));
    stream.delta(&delta(3, 1, 0.0), MODE, SCOPE);
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Indeterminate
    );
    assert!(stream.snapshot(&snapshot(3, 0, None), MODE, SCOPE));
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Determinate(0.0)
    );
    assert!(!stream.snapshot(&snapshot(3, 0, None), MODE, SCOPE));
    stream.delta(&delta(2, 100, 80.0), MODE, SCOPE);
    assert!(!stream.snapshot(&snapshot(2, 100, Some(80.0)), MODE, SCOPE));
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Determinate(0.0)
    );
    stream.delta(&delta(3, 2, 42.0), MODE, SCOPE);
    stream.delta(&delta(3, 1, 0.0), MODE, SCOPE);
    assert!((stream.tracker.progress().expect("known") - 0.42).abs() < 1e-9);
}

#[test]
fn taskbar_stream_handles_snapshot_first_and_coalesced_future_bases() {
    let mut stream = TaskbarProgressStream::default();
    assert!(stream.snapshot(&snapshot(3, 0, None), MODE, SCOPE));
    stream.delta(&delta(3, 1, 0.0), MODE, SCOPE);
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Determinate(0.0)
    );
    stream.delta(&delta(5, 3, 20.0), MODE, SCOPE);
    stream.delta(&delta(4, 4, 90.0), MODE, SCOPE);
    assert!(stream.snapshot(&snapshot(4, 0, None), MODE, SCOPE));
    assert!(stream.snapshot(&snapshot(5, 0, None), MODE, SCOPE));
    assert!((stream.tracker.progress().expect("known") - 0.2).abs() < 1e-9);
    assert!(stream.snapshot(&snapshot(6, 0, None), MODE, SCOPE));
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Indeterminate
    );
    stream.delta(&delta(5, 100, 70.0), MODE, SCOPE);
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Indeterminate
    );
}

#[test]
fn taskbar_stream_receives_ordered_sparse_coverage_through_listener_coalescing() {
    let events: Vec<QueueStateLiteDelta> = serde_json::from_str(include_str!(
        "../../../tests/queue-delta-publication-contract.json"
    ))
    .expect("publication contract");
    let mut pending = PendingQueueLiteDelta::default();
    for event in events {
        pending.push(event);
    }
    pending.push(delta(2, 1, 90.0));
    let coalesced = pending.take_coalesced().expect("new base patches");
    let mut stream = TaskbarProgressStream::default();
    stream.delta(&coalesced, MODE, SCOPE);
    let mut current = snapshot(3, 0, None);
    current.jobs[0].id = "A".into();
    let mut second = current.jobs[0].clone();
    second.id = "B".into();
    current.jobs.push(second);
    assert!(stream.snapshot(&current, MODE, SCOPE));
    assert!((stream.tracker.progress().expect("both measured") - 0.25).abs() < 1e-9);
    assert_eq!(
        stream.tracker.display_progress().windows_percent(),
        Some(25)
    );
}

#[test]
fn taskbar_snapshot_listener_retains_new_run_reset_against_late_old_callbacks() {
    let mut old = snapshot(2, 0, Some(50.0));
    old.jobs[0].status = JobStatus::Paused;
    let current = snapshot(3, 0, None);
    let mut pending = crate::queue_events::PendingQueueUiLiteSnapshot::default();
    assert!(pending.push(current));
    assert!(!pending.push(old.clone()));
    assert!(pending.has_pending());
    let reset = pending.take().expect("new run snapshot retained");
    assert_eq!(reset.snapshot_revision, 3);
    assert_eq!(reset.jobs[0].status, JobStatus::Processing);
    assert!(reset.jobs[0].wait_metadata.is_none());
    assert!(!pending.push(old.clone()));
    assert!(!pending.has_pending());

    let mut stream = TaskbarProgressStream::default();
    assert!(stream.snapshot(&old, MODE, SCOPE));
    stream.delta(&delta(3, 1, 0.0), MODE, SCOPE);
    assert!(stream.snapshot(&reset, MODE, SCOPE));
    assert_eq!(
        stream.tracker.display_progress(),
        TaskbarProgressValue::Determinate(0.0)
    );

    let newer_measurement = snapshot(3, 2, Some(42.0));
    assert!(pending.push(newer_measurement));
    assert!(!pending.push(reset));
    assert!(!pending.push(snapshot(2, 100, Some(90.0))));
    let measured = pending.take().expect("latest same-base measurement");
    assert!(stream.snapshot(&measured, MODE, SCOPE));
    assert!((stream.tracker.progress().expect("known") - 0.42).abs() < 1e-9);
}

#[test]
fn taskbar_integer_projection_retains_running_limit_and_video_full_phase() {
    let mut stream = TaskbarProgressStream::default();
    assert!(stream.snapshot(&snapshot(1, 0, Some(99.9)), MODE, SCOPE));
    assert!(!stream.tracker.completed_queue());
    assert_eq!(
        stream.tracker.display_progress().windows_percent(),
        Some(99)
    );
    let mut completed = snapshot(2, 0, Some(100.0));
    completed.jobs[0].status = JobStatus::Completed;
    assert!(stream.snapshot(&completed, MODE, SCOPE));
    assert!(stream.tracker.completed_queue());
    assert_eq!(
        stream.tracker.display_progress().windows_percent(),
        Some(100)
    );
    let mut video_phase = snapshot(3, 0, Some(100.0));
    video_phase.jobs[0].execution_mode = Some(JobExecutionMode::Video);
    assert!(stream.snapshot(&video_phase, MODE, SCOPE));
    assert!(!stream.tracker.completed_queue());
    assert_eq!(
        stream.tracker.display_progress().windows_percent(),
        Some(100)
    );
    assert_eq!(
        TaskbarProgressValue::Determinate(0.425).windows_percent(),
        Some(43)
    );
    assert_eq!(TaskbarProgressValue::Indeterminate.windows_percent(), None);
}
