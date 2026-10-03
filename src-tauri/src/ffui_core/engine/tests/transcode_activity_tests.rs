use std::sync::Arc;

use super::*;
use crate::ffui_core::domain::{JobSource, JobType};

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

    inner
        .state
        .lock_unpoisoned()
        .jobs
        .get_mut(&job.id)
        .expect("job should exist")
        .status = JobStatus::Paused;

    update_job_progress(&inner, &job.id, Some(1.0), None, None, None, None);

    assert!(
        inner.state.lock_unpoisoned().settings.monitor.is_none(),
        "paused jobs must not create or update monitor.transcodeActivityDays"
    );
}

#[test]
fn processing_jobs_mark_transcode_activity() {
    let directory = tempfile::tempdir().expect("data directory");
    let _data_root =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
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

    inner
        .state
        .lock_unpoisoned()
        .jobs
        .get_mut(&job.id)
        .expect("job should exist")
        .status = JobStatus::Processing;

    update_job_progress(&inner, &job.id, Some(1.0), None, None, None, None);

    let has_activity = inner
        .state
        .lock_unpoisoned()
        .settings
        .monitor
        .as_ref()
        .expect("monitor settings should exist after processing activity")
        .transcode_activity_days
        .as_ref()
        .expect("transcodeActivityDays should exist after processing activity")
        .iter()
        .any(|d| d.active_hours_mask != 0);
    assert!(
        has_activity,
        "processing activity must set at least one hour bit"
    );
    let persisted = settings::SettingsStore::open()
        .expect("persisted activity")
        .snapshot()
        .settings;
    assert!(
        persisted
            .monitor
            .expect("monitor")
            .transcode_activity_days
            .expect("days")
            .iter()
            .any(|day| day.active_hours_mask != 0)
    );
}
