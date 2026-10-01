use super::*;
use crate::ffui_core::{TranscodeJobLiteTelemetryDelta, settings::AppSettings};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

fn patch(id: &str, percent: f64) -> TranscodeJobLiteDeltaPatch {
    TranscodeJobLiteDeltaPatch {
        id: id.into(),
        status: None,
        processing_started_ms: None,
        progress: Some(percent),
        skip_reason: None,
        telemetry: Some(TranscodeJobLiteTelemetryDelta {
            last_progress_percent: Some(percent),
            progress_epoch: Some(1),
            last_progress_out_time_seconds: None,
            last_progress_speed: None,
            last_progress_updated_at_ms: None,
            last_progress_frame: None,
            phase: Default::default(),
        }),
        elapsed_ms: None,
        preview: None,
    }
}

#[test]
fn delta_publication_drains_staged_sparse_events_before_late_producer_notification() {
    let inner = Inner::new(Vec::new(), AppSettings::default());
    let received = Arc::new(Mutex::new(Vec::new()));
    let receiver = received.clone();
    inner
        .queue_lite_delta_listeners
        .lock_unpoisoned()
        .push(Arc::new(move |delta| {
            receiver.lock_unpoisoned().push(delta);
        }));
    {
        let mut state = inner.state.lock_unpoisoned();
        state.queue_snapshot_revision = 3;
        state.stage_queue_lite_delta(vec![patch("A", 0.0)]);
    }
    {
        let mut state = inner.state.lock_unpoisoned();
        state.stage_queue_lite_delta(vec![patch("B", 50.0)]);
    }
    notify_queue_lite_delta_listeners(&inner);
    notify_queue_lite_delta_listeners(&inner);
    let actual =
        serde_json::to_value(&*received.lock_unpoisoned()).expect("serialize published deltas");
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../tests/queue-delta-publication-contract.json"
    ))
    .expect("read publication contract");
    assert_eq!(actual, expected);
}

#[test]
fn delta_publication_serializes_callbacks_while_other_producers_stage() {
    let inner = Arc::new(Inner::new(Vec::new(), AppSettings::default()));
    let (entered_send, entered_recv) = mpsc::channel();
    let (resume_send, resume_recv) = mpsc::channel();
    let resume_recv = Mutex::new(resume_recv);
    let received = Arc::new(Mutex::new(Vec::new()));
    let receiver = received.clone();
    let weak_inner = Arc::downgrade(&inner);
    inner
        .queue_lite_delta_listeners
        .lock_unpoisoned()
        .push(Arc::new(move |delta| {
            assert!(
                weak_inner
                    .upgrade()
                    .expect("live engine")
                    .state
                    .try_lock()
                    .is_ok()
            );
            if delta.delta_revision == 1 {
                entered_send.send(()).expect("signal first callback");
                resume_recv
                    .lock_unpoisoned()
                    .recv_timeout(Duration::from_secs(5))
                    .expect("resume callback");
            }
            receiver.lock_unpoisoned().push(delta.delta_revision);
        }));
    inner
        .state
        .lock_unpoisoned()
        .stage_queue_lite_delta(vec![patch("A", 0.0)]);
    let publishing_inner = inner.clone();
    let publisher =
        std::thread::spawn(move || notify_queue_lite_delta_listeners(&publishing_inner));
    entered_recv
        .recv_timeout(Duration::from_secs(5))
        .expect("first callback entered");
    inner
        .state
        .lock_unpoisoned()
        .stage_queue_lite_delta(vec![patch("B", 50.0)]);
    notify_queue_lite_delta_listeners(&inner);
    assert!(received.lock_unpoisoned().is_empty());
    resume_send.send(()).expect("release first callback");
    publisher.join().expect("publication worker");
    assert_eq!(*received.lock_unpoisoned(), vec![1, 2]);
}

#[test]
fn delta_publication_supports_reentrant_notifications_and_advancing_bases() {
    let inner = Arc::new(Inner::new(Vec::new(), AppSettings::default()));
    let weak_inner = Arc::downgrade(&inner);
    let received = Arc::new(Mutex::new(Vec::new()));
    let receiver = received.clone();
    inner
        .queue_lite_delta_listeners
        .lock_unpoisoned()
        .push(Arc::new(move |delta| {
            receiver
                .lock_unpoisoned()
                .push((delta.base_snapshot_revision, delta.delta_revision));
            if delta.delta_revision == 1 {
                let inner = weak_inner.upgrade().expect("live engine");
                {
                    let mut state = inner.state.lock_unpoisoned();
                    state.queue_snapshot_revision = 4;
                    state.stage_queue_lite_delta(vec![patch("B", 50.0)]);
                }
                notify_queue_lite_delta_listeners(&inner);
            }
        }));
    {
        let mut state = inner.state.lock_unpoisoned();
        state.queue_snapshot_revision = 3;
        state.stage_queue_lite_delta(vec![patch("A", 0.0)]);
    }
    notify_queue_lite_delta_listeners(&inner);
    assert_eq!(*received.lock_unpoisoned(), vec![(3, 1), (4, 2)]);
    assert!(!inner.state.lock_unpoisoned().queue_delta_dispatching);
}
