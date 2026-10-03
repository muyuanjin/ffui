use super::*;
use std::time::{Duration, Instant};

pub(super) fn managed_job(engine: &TranscodingEngine, output: &Path, realtime: bool) -> String {
    let mut args: Vec<String> = [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-t",
        "0.1",
        "-c:a",
        "pcm_s16le",
    ]
    .map(str::to_string)
    .to_vec();
    if realtime {
        args[5] = "10".into();
        args.insert(0, "-re".into());
    }
    args.push(output.to_string_lossy().into_owned());
    let argument_index = u32::try_from(args.len() - 1).expect("index");
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Managed generator".into(),
            args: args.clone(),
            working_directory: None,
        })
        .expect("enqueue");
    let mut state = engine.inner.state.lock_unpoisoned();
    let stored = state.jobs.get_mut(&job.id).expect("job");
    stored.execution = Some(JobExecution::Ffmpeg {
        invocation: FfmpegInvocation {
            args,
            working_directory: None,
            progress: None,
            output: FfmpegOutput::ManagedFile {
                path: output.to_string_lossy().into_owned(),
                argument_index,
            },
        },
    });
    stored.output_path = Some(output.to_string_lossy().into_owned());
    job.id
}

fn start(engine: &Arc<TranscodingEngine>, job_id: &str) -> std::thread::JoinHandle<Result<()>> {
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        assert_eq!(
            worker::next_job_for_worker_locked(&mut state).as_deref(),
            Some(job_id)
        );
    }
    let worker_engine = engine.clone();
    let worker_id = job_id.to_string();
    let handle = std::thread::spawn(move || {
        job_runner::process_transcode_job(&worker_engine.inner, &worker_id)
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let job = engine.inner.state.lock_unpoisoned().jobs[job_id].clone();
        if job
            .wait_metadata
            .as_ref()
            .and_then(|meta| meta.tmp_output_path.as_ref())
            .is_some()
        {
            break;
        }
        assert_eq!(
            job.status,
            JobStatus::Processing,
            "{:?}",
            job.failure_reason
        );
        assert!(
            Instant::now() < deadline,
            "runner never reserved output; finished={}, job={job:?}",
            handle.is_finished()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    handle
}

#[test]
fn wait_replays_from_zero_and_cancel_cleans_only_owned_temporary_output() {
    let directory = tempfile::tempdir().expect("tempdir");
    let output = directory.path().join("output.wav");
    let user_file = directory.path().join("user.wav");
    fs::write(&user_file, b"keep").expect("write");
    let engine = Arc::new(engine(crate::test_support::make_ffmpeg_preset_for_tests(
        "unused",
    )));
    let job_id = managed_job(&engine, &output, true);
    let handle = start(&engine, &job_id);
    assert!(engine.wait_job(&job_id));
    handle.join().expect("join").expect("process");
    assert!(!output.exists());
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs[&job_id].status,
        JobStatus::Paused
    );
    assert!(engine.resume_job(&job_id));
    let handle = start(&engine, &job_id);
    assert!(engine.cancel_job(&job_id));
    handle.join().expect("join").expect("process");
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job_id].clone();
    assert_eq!(stored.status, JobStatus::Cancelled);
    assert!(stored.runs.len() >= 2);
    assert!(stored.wait_metadata.is_none());
    assert_eq!(fs::read(&user_file).expect("read"), b"keep");
    assert_eq!(fs::read_dir(directory.path()).expect("list").count(), 1);
}

#[test]
fn publish_conflict_fails_without_overwriting_or_leaving_owned_temp() {
    let directory = tempfile::tempdir().expect("tempdir");
    let output = directory.path().join("output.wav");
    fs::write(&output, b"existing user output").expect("write");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job_id = managed_job(&engine, &output, false);
    process(&engine, &job_id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job_id].clone();
    assert_eq!(stored.status, JobStatus::Failed);
    assert!(
        stored
            .failure_reason
            .expect("diagnostic")
            .contains("publish")
    );
    assert_eq!(fs::read(&output).expect("read"), b"existing user output");
    assert_eq!(fs::read_dir(directory.path()).expect("list").count(), 1);
}

#[test]
fn relative_managed_enqueue_persists_absolute_addresses_and_cleans_crash_temp() {
    let cwd = std::env::current_dir().expect("cwd");
    let directory = tempfile::tempdir_in(&cwd).expect("tempdir");
    let input = directory.path().join("input.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.1"],
        &input,
    );
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("relative");
    preset.container = Some(ContainerConfig {
        format: Some("wav".into()),
        movflags: None,
    });
    let original = engine(preset.clone());
    let relative = input.strip_prefix(&cwd).expect("relative");
    let mut job = original.enqueue_transcode_job(
        relative.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "relative".into(),
    );
    assert_eq!(job.filename, relative.to_string_lossy());
    assert_eq!(
        job.input_path.as_deref(),
        Some(input.to_str().expect("input"))
    );
    assert!(Path::new(job.output_path.as_deref().expect("output")).is_absolute());
    let leftover = directory.path().join(format!(".ffui-{}-crash.wav", job.id));
    fs::write(&leftover, b"incomplete").expect("temp");
    job.wait_metadata = Some(
        serde_json::from_value(serde_json::json!({ "tmpOutputPath": leftover.to_string_lossy() }))
            .expect("metadata"),
    );
    job.status = JobStatus::Processing;
    let encoded = serde_json::to_vec(&crate::ffui_core::JobRecord::from(
        crate::ffui_core::TranscodeJobLite::from(&job),
    ))
    .expect("persist");
    let restored = crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(
        serde_json::from_slice::<crate::ffui_core::JobRecord>(&encoded).expect("load"),
    ));
    let fresh = engine(preset);
    fresh.inner.state.lock_unpoisoned().presets = Arc::new(Vec::new());
    super::super::super::state::restore_jobs_from_snapshot(
        &fresh.inner,
        crate::ffui_core::QueueState {
            jobs: vec![restored],
        },
    );
    assert_eq!(fresh.resume_startup_auto_paused_jobs(), 1);
    process(&fresh, &job.id);
    assert!(!leftover.exists());
    let stored = fresh.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    assert_eq!(
        &fs::read(stored.output_path.expect("output")).expect("wav")[..4],
        b"RIFF"
    );
}

#[test]
fn recovery_removes_the_recorded_owned_temp_before_replaying() {
    let directory = tempfile::tempdir().expect("tempdir");
    let output = directory.path().join("output.wav");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job_id = managed_job(&engine, &output, false);
    let leftover = directory
        .path()
        .join(format!(".ffui-{job_id}-crash.tmp.wav"));
    fs::write(&leftover, b"incomplete").expect("write");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.get_mut(&job_id).expect("job").wait_metadata = Some(
            serde_json::from_value(
                serde_json::json!({ "tmpOutputPath": leftover.to_string_lossy() }),
            )
            .expect("metadata"),
        );
    }
    process(&engine, &job_id);
    assert!(!leftover.exists());
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs[&job_id].status,
        JobStatus::Completed
    );
    assert_eq!(&fs::read(&output).expect("wav")[..4], b"RIFF");
}
