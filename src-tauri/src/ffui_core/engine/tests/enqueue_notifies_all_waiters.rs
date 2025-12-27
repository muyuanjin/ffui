use std::sync::mpsc;
use std::time::Duration;

use crate::ffui_core::domain::{JobSource, JobType};
use crate::ffui_core::engine::TranscodingEngine;
use crate::sync_ext::{CondvarExt, MutexExt};

#[test]
fn enqueue_wakes_all_condvar_waiters() {
    let engine = TranscodingEngine::new().expect("engine should start");

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.clear();
        state.queue.clear();
    }

    let inner = engine.inner.clone();
    let (tx, rx) = mpsc::channel::<()>();

    for _ in 0..2 {
        let inner_clone = inner.clone();
        let tx_clone = tx.clone();
        std::thread::spawn(move || {
            let mut state = inner_clone.state.lock_unpoisoned();
            while state.queue.is_empty() {
                state = inner_clone.cv.wait_unpoisoned(state);
            }
            tx_clone.send(()).expect("signal waiter woken");
        });
    }

    engine.enqueue_transcode_job(
        "C:/dummy/input.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "missing-preset".to_string(),
    );

    // Both waiters should be woken by the enqueue notification so worker
    // threads can reach the configured concurrency immediately.
    rx.recv_timeout(Duration::from_secs(1))
        .expect("waiter 1 woken");
    rx.recv_timeout(Duration::from_secs(1))
        .expect("waiter 2 woken");
}
