use super::*;

fn old_record(engine: &TranscodingEngine, input: &Path) -> crate::ffui_core::TranscodeJob {
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        1.0,
        None,
        "legacy".into(),
    );
    let record = crate::ffui_core::JobRecord::from(crate::ffui_core::TranscodeJobLite::from(&job));
    let mut value = serde_json::to_value(record).expect("record");
    value["config"]
        .as_object_mut()
        .expect("config")
        .remove("execution");
    let record = serde_json::from_value::<crate::ffui_core::JobRecord>(value).expect("old record");
    let mut job =
        crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(record));
    assert!(job.execution.is_none());
    job.status = JobStatus::Processing;
    job
}

#[test]
fn terminal_legacy_actions_preserve_unowned_files() {
    for preset_kind in ["advanced", "missing", "structured"] {
        for status in [
            JobStatus::Failed,
            JobStatus::Cancelled,
            JobStatus::Completed,
            JobStatus::Skipped,
        ] {
            for operation in ["restart", "restart-bulk", "delete", "delete-bulk"] {
                if operation.starts_with("restart")
                    && matches!(status, JobStatus::Completed | JobStatus::Skipped)
                {
                    continue;
                }
                let directory = tempfile::tempdir().expect("tempdir");
                let input = directory.path().join("input.mp4");
                let output = directory.path().join("out.mp4");
                let sentinels = [
                    output.with_extension("concat.list"),
                    output.with_extension("video.concat.tmp.mp4"),
                    output.with_extension("concat.tmp.mp4"),
                    input.with_file_name("input.compressed.tmp.mp4"),
                ];
                for path in &sentinels {
                    fs::write(path, b"user-owned").expect("sentinel");
                }
                let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
                let seed = engine(preset.clone());
                let mut job = old_record(&seed, &input);
                job.status = status;
                job.output_path = Some(output.to_string_lossy().into_owned());
                job.wait_metadata = None;
                let historical_logs = job.logs.clone();
                match preset_kind {
                    "advanced" => {
                        preset.advanced_enabled = Some(true);
                        preset.ffmpeg_template = Some("ffmpeg -f lavfi -i sine -f null NUL".into());
                    }
                    "missing" => preset.id = "unrelated".into(),
                    "structured" => {}
                    _ => unreachable!(),
                }
                let fresh = engine(preset);
                super::super::super::state::restore_jobs_from_snapshot(
                    &fresh.inner,
                    crate::ffui_core::QueueState {
                        jobs: vec![job.clone()],
                    },
                );
                {
                    let state = fresh.inner.state.lock_unpoisoned();
                    assert!(state.jobs[&job.id].execution.is_none());
                    assert_eq!(state.jobs[&job.id].logs, historical_logs);
                }
                let accepted = match operation {
                    "restart" => fresh.restart_job(&job.id),
                    "restart-bulk" => fresh.restart_jobs_bulk(vec![job.id.clone()]),
                    "delete" => fresh.delete_job(&job.id),
                    "delete-bulk" => fresh.delete_jobs_bulk(vec![job.id.clone()]),
                    _ => unreachable!(),
                };
                assert!(accepted, "{preset_kind} {status:?} {operation}");
                for path in &sentinels {
                    assert_eq!(
                        fs::read(path).expect("unowned file must remain"),
                        b"user-owned",
                        "{preset_kind} {status:?} {operation}: {}",
                        path.display()
                    );
                }
            }
        }
    }
}

#[test]
fn terminal_legacy_cleanup_only_removes_recorded_segments() {
    let directory = tempfile::tempdir().expect("tempdir");
    let preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
    let fresh = engine(preset);
    let mut job = old_record(&fresh, &directory.path().join("input.mp4"));
    let output = directory.path().join("out.mp4");
    let recorded = directory.path().join("recorded.tmp.mp4");
    let marker = recorded.with_extension("noaudio.done");
    let unrecorded = output.with_extension("concat.list");
    fs::write(&recorded, b"owned").expect("recorded segment");
    fs::write(&marker, b"owned marker").expect("associated marker");
    fs::write(&unrecorded, b"unowned").expect("unrecorded sentinel");
    job.status = JobStatus::Failed;
    job.output_path = Some(output.to_string_lossy().into_owned());
    job.wait_metadata = Some(
        serde_json::from_value(serde_json::json!({
            "tmpOutputPath": recorded.to_string_lossy()
        }))
        .expect("recorded ownership"),
    );
    fresh
        .inner
        .state
        .lock_unpoisoned()
        .jobs
        .insert(job.id.clone(), job.clone());
    assert!(fresh.delete_job(&job.id));
    assert!(!recorded.exists());
    assert!(!marker.exists());
    assert_eq!(fs::read(unrecorded).expect("sentinel"), b"unowned");
}

#[test]
fn legacy_advanced_record_never_auto_replays_but_explicit_restart_runs() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("input.mp4");
    let external = directory.path().join("external.wav");
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some(format!(
        "ffmpeg -f lavfi -i sine=frequency=440 -t 0.1 \"{}\"",
        external.display()
    ));
    let seed = engine(preset.clone());
    let job = old_record(&seed, &input);
    let fresh = engine(preset.clone());
    super::super::super::state::restore_jobs_from_snapshot(
        &fresh.inner,
        crate::ffui_core::QueueState {
            jobs: vec![job.clone()],
        },
    );
    assert_eq!(fresh.resume_startup_auto_paused_jobs(), 0);
    assert!(!fresh.resume_job(&job.id));
    assert!(fresh.resume_jobs_bulk(vec![job.id.clone()]));
    assert_eq!(
        fresh.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Paused
    );
    assert!(worker::next_job_for_worker_locked(&mut fresh.inner.state.lock_unpoisoned()).is_none());
    assert!(!external.exists());

    for operation in ["startup", "single", "bulk", "wait", "bulk-wait"] {
        let runtime = engine(preset.clone());
        let mut legacy = job.clone();
        legacy.status = if operation.contains("wait") {
            JobStatus::Queued
        } else {
            JobStatus::Paused
        };
        {
            let mut state = runtime.inner.state.lock_unpoisoned();
            state.jobs.insert(legacy.id.clone(), legacy);
        }
        match operation {
            "startup" => {
                runtime
                    .inner
                    .startup_auto_paused_job_ids
                    .lock_unpoisoned()
                    .insert(job.id.clone());
                assert_eq!(runtime.resume_startup_auto_paused_jobs(), 0);
            }
            "single" => assert!(!runtime.resume_job(&job.id)),
            "bulk" => assert!(runtime.resume_jobs_bulk(vec![job.id.clone()])),
            "wait" => assert!(!runtime.wait_job(&job.id)),
            "bulk-wait" => assert!(runtime.wait_jobs_bulk(vec![job.id.clone()])),
            _ => unreachable!(),
        }
        let mut state = runtime.inner.state.lock_unpoisoned();
        assert!(
            matches!(&state.jobs[&job.id].execution, Some(JobExecution::Ffmpeg { invocation }) if matches!(invocation.output, FfmpegOutput::Transparent))
        );
        assert_eq!(
            state.jobs[&job.id].status,
            if operation.contains("wait") {
                JobStatus::Queued
            } else {
                JobStatus::Paused
            },
            "{operation}"
        );
        if !operation.contains("wait") {
            assert!(
                worker::next_job_for_worker_locked(&mut state).is_none(),
                "{operation}"
            );
        }
        assert!(state.wait_requests.is_empty());
    }

    assert!(fresh.restart_job(&job.id));
    process(&fresh, &job.id);
    assert_eq!(
        fresh.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Completed
    );
    assert_eq!(&fs::read(&external).expect("explicit output")[..4], b"RIFF");
}

#[test]
fn legacy_structured_video_keeps_startup_and_single_resume_capability() {
    let directory = tempfile::tempdir().expect("tempdir");
    let preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
    let seed = engine(preset.clone());
    let job = old_record(&seed, &directory.path().join("input.mp4"));
    let fresh = engine(preset);
    super::super::super::state::restore_jobs_from_snapshot(
        &fresh.inner,
        crate::ffui_core::QueueState {
            jobs: vec![job.clone()],
        },
    );
    assert_eq!(fresh.resume_startup_auto_paused_jobs(), 1);
    assert!(matches!(
        fresh.inner.state.lock_unpoisoned().jobs[&job.id].execution,
        Some(JobExecution::Video { .. })
    ));
    assert!(fresh.wait_job(&job.id));
    assert!(fresh.resume_job(&job.id));
}

#[test]
fn missing_legacy_preset_cannot_gain_replay_permission_after_import() {
    let directory = tempfile::tempdir().expect("tempdir");
    let preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
    let seed = engine(preset.clone());
    let job = old_record(&seed, &directory.path().join("input.mp4"));
    let external = directory.path().join("external.wav");
    for operation in ["restore-startup", "startup", "single", "bulk"] {
        let fresh = engine(crate::test_support::make_ffmpeg_preset_for_tests(
            "unrelated",
        ));
        if operation == "restore-startup" {
            super::super::super::state::restore_jobs_from_snapshot(
                &fresh.inner,
                crate::ffui_core::QueueState {
                    jobs: vec![job.clone()],
                },
            );
        } else {
            let mut legacy = job.clone();
            legacy.status = JobStatus::Paused;
            fresh
                .inner
                .state
                .lock_unpoisoned()
                .jobs
                .insert(job.id.clone(), legacy);
            fresh
                .inner
                .startup_auto_paused_job_ids
                .lock_unpoisoned()
                .insert(job.id.clone());
        }
        {
            let mut state = fresh.inner.state.lock_unpoisoned();
            state.settings.max_parallel_jobs = Some(1);
            let mut blocker = crate::test_support::make_transcode_job_for_tests(
                "blocker",
                JobStatus::Processing,
                0.0,
                None,
            );
            blocker.execution = Some(JobExecution::Video {
                preset: Box::new(preset.clone()),
            });
            state.jobs.insert(blocker.id.clone(), blocker);
            state.active_jobs.insert("blocker".into());
        }
        match operation {
            "restore-startup" | "startup" => assert_eq!(fresh.resume_startup_auto_paused_jobs(), 0),
            "single" => assert!(!fresh.resume_job(&job.id)),
            "bulk" => assert!(fresh.resume_jobs_bulk(vec![job.id.clone()])),
            _ => unreachable!(),
        }
        {
            let mut state = fresh.inner.state.lock_unpoisoned();
            let stored = &state.jobs[&job.id];
            assert_eq!(stored.status, JobStatus::Paused, "{operation}");
            assert!(
                matches!(stored.execution, Some(JobExecution::Invalid { .. })),
                "{operation}"
            );
            assert!(
                stored
                    .failure_reason
                    .as_deref()
                    .is_some_and(|reason| reason.contains("No preset found"))
            );
            let mut advanced = preset.clone();
            advanced.advanced_enabled = Some(true);
            advanced.ffmpeg_template = Some(format!(
                "ffmpeg -y -f lavfi -i sine=frequency=440 -t 0.1 \"{}\"",
                external.display()
            ));
            state.presets = Arc::new(vec![advanced]);
            state.active_jobs.remove("blocker");
            state.jobs.remove("blocker");
            assert!(
                worker::next_job_for_worker_locked(&mut state).is_none(),
                "{operation}"
            );
        }
        assert!(!fresh.resume_job(&job.id));
        assert!(fresh.restart_job(&job.id));
        process(&fresh, &job.id);
        let stored = fresh.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(stored.status, JobStatus::Failed);
        assert!(
            stored
                .failure_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("No preset found"))
        );
        assert!(!external.exists());
    }
}
