use super::*;

#[test]
fn stopped_managed_wait_resumes_from_zero_after_the_wait_request_is_cancelled() {
    let directory = tempfile::tempdir().expect("directory");
    let output = directory.path().join("output.wav");
    let runtime = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job_id = super::managed::managed_job(&runtime, &output, true);
    worker::next_job_for_worker_locked(&mut runtime.inner.state.lock_unpoisoned()).expect("select");
    let invocation = match runtime.inner.state.lock_unpoisoned().jobs[&job_id]
        .execution
        .clone()
        .expect("execution")
    {
        JobExecution::Ffmpeg { invocation } => invocation,
        _ => panic!("managed invocation"),
    };
    let temporary = tempfile::Builder::new()
        .suffix(".wav")
        .tempfile_in(directory.path())
        .expect("temporary")
        .into_temp_path();
    let temporary_path = temporary.to_path_buf();
    let mut args = invocation.args.clone();
    *args.last_mut().expect("output") = temporary.to_string_lossy().into_owned();
    args.insert(0, "-y".into());
    let mut polls = 0;
    let outcome = process::run(
        ffmpeg_program(),
        &invocation,
        &args,
        || {
            polls += 1;
            if polls == 1 {
                return None;
            }
            assert!(runtime.wait_job(&job_id));
            let observed = requested_stop(&runtime.inner, &job_id, 0);
            assert_eq!(observed, Some(StopReason::Wait));
            assert!(runtime.resume_job(&job_id));
            observed
        },
        |_| {},
    )
    .expect("terminated process");
    assert!(matches!(outcome, ProcessOutcome::Stopped(StopReason::Wait)));
    finish_run(
        &runtime.inner,
        &job_id,
        0,
        &invocation.output,
        Some(ManagedTemporary {
            path: temporary,
            file_times: None,
        }),
        Ok(outcome),
    );
    assert!(!temporary_path.exists());
    {
        let mut state = runtime.inner.state.lock_unpoisoned();
        let job = &state.jobs[&job_id];
        assert_eq!(job.status, JobStatus::Queued);
        assert_eq!(job.progress, 0.0);
        assert!(job.failure_reason.is_none());
        assert_eq!(state.queue.iter().filter(|id| *id == &job_id).count(), 1);
        state.active_jobs.remove(&job_id);
        state.active_inputs.clear();
        if let Some(JobExecution::Ffmpeg { invocation }) =
            &mut state.jobs.get_mut(&job_id).expect("job").execution
        {
            let duration = invocation
                .args
                .iter()
                .position(|arg| arg == "-t")
                .expect("duration");
            invocation.args[duration + 1] = "0.1".into();
        }
    }
    super::process(&runtime, &job_id);
    let stored = runtime.inner.state.lock_unpoisoned().jobs[&job_id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    assert_eq!(&fs::read(output).expect("output")[..4], b"RIFF");
}

#[test]
fn stopped_before_launch_retains_reason_and_does_not_replay_transparent_side_effects() {
    let invocation = FfmpegInvocation {
        args: vec!["-version".into()],
        working_directory: None,
        output: FfmpegOutput::Transparent,
        progress: None,
    };
    let outcome = process::run(
        "missing-program",
        &invocation,
        &invocation.args,
        || Some(StopReason::Wait),
        |_| {},
    )
    .expect("no launch");
    assert!(matches!(outcome, ProcessOutcome::Stopped(StopReason::Wait)));
    let runtime = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job = runtime
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "analysis".into(),
            args: invocation.args.clone(),
            working_directory: None,
        })
        .expect("enqueue");
    worker::next_job_for_worker_locked(&mut runtime.inner.state.lock_unpoisoned()).expect("select");
    finish_run(
        &runtime.inner,
        &job.id,
        0,
        &invocation.output,
        None,
        Ok(outcome),
    );
    let state = runtime.inner.state.lock_unpoisoned();
    assert_eq!(state.jobs[&job.id].status, JobStatus::Failed);
    assert!(!state.queue.contains(&job.id));
}

#[test]
fn cancelled_stop_takes_precedence_over_a_resumed_wait() {
    let directory = tempfile::tempdir().expect("directory");
    let runtime = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let output = directory.path().join("output.wav");
    let job_id = super::managed::managed_job(&runtime, &output, true);
    worker::next_job_for_worker_locked(&mut runtime.inner.state.lock_unpoisoned()).expect("select");
    assert!(runtime.wait_job(&job_id));
    assert!(runtime.resume_job(&job_id));
    assert!(runtime.cancel_job(&job_id));
    let invocation = match runtime.inner.state.lock_unpoisoned().jobs[&job_id]
        .execution
        .clone()
        .expect("execution")
    {
        JobExecution::Ffmpeg { invocation } => invocation,
        _ => panic!("managed"),
    };
    finish_run(
        &runtime.inner,
        &job_id,
        0,
        &invocation.output,
        None,
        Ok(ProcessOutcome::Stopped(StopReason::Wait)),
    );
    let state = runtime.inner.state.lock_unpoisoned();
    assert_eq!(state.jobs[&job_id].status, JobStatus::Cancelled);
    assert!(!state.queue.contains(&job_id));
    assert!(!output.exists());
}
