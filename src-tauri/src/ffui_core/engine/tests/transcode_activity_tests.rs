use std::sync::Arc;

use super::*;
use crate::ffui_core::domain::{
    JobSource,
    JobType,
};

#[test]
fn paused_jobs_do_not_mark_transcode_activity() {
    let presets = vec![common::make_test_preset()];
    let settings = AppSettings::default();
    let inner = Arc::new(Inner::new(presets, settings));

    let job = enqueue_transcode_job(
        &inner,
        "example.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        1.0,
        None,
        "preset-1".to_string(),
    );

    {
        let mut state = inner.state.lock_unpoisoned();
        let j = state.jobs.get_mut(&job.id).expect("job should exist");
        j.status = JobStatus::Paused;
    }

    update_job_progress(&inner, &job.id, Some(1.0), None, None);

    let state = inner.state.lock_unpoisoned();
    assert!(
        state.settings.monitor.is_none(),
        "paused jobs must not create or update monitor.transcodeActivityDays"
    );
}

#[test]
fn processing_jobs_mark_transcode_activity() {
    let presets = vec![common::make_test_preset()];
    let settings = AppSettings::default();
    let inner = Arc::new(Inner::new(presets, settings));

    let job = enqueue_transcode_job(
        &inner,
        "example.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        1.0,
        None,
        "preset-1".to_string(),
    );

    {
        let mut state = inner.state.lock_unpoisoned();
        let j = state.jobs.get_mut(&job.id).expect("job should exist");
        j.status = JobStatus::Processing;
    }

    update_job_progress(&inner, &job.id, Some(1.0), None, None);

    let state = inner.state.lock_unpoisoned();
    let monitor = state
        .settings
        .monitor
        .as_ref()
        .expect("monitor settings should exist after processing activity");
    let days = monitor
        .transcode_activity_days
        .as_ref()
        .expect("transcodeActivityDays should exist after processing activity");
    assert!(
        days.iter().any(|d| d.active_hours_mask != 0),
        "processing activity must set at least one hour bit"
    );
}
