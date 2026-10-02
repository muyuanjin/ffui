use std::path::PathBuf;

use super::*;

#[test]
fn image2_template_extension_follows_explicit_encoder_without_rewriting_arguments() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("input.webp");
    for (codec, extension) in [
        ("png", "png"),
        ("mjpeg", "jpg"),
        ("bmp", "bmp"),
        ("tiff", "tiff"),
        ("copy", "webp"),
    ] {
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("image");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(format!(
            "ffmpeg -f image2 -i INPUT -c:v {codec} -f image2 OUTPUT"
        ));
        let runtime = engine(preset);
        let job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Image,
            JobSource::Manual,
            1.0,
            None,
            "image".into(),
        );
        let path = job.output_path.as_deref().expect("known output");
        assert_eq!(
            Path::new(path).extension().and_then(|value| value.to_str()),
            Some(extension)
        );
        let Some(JobExecution::Ffmpeg { invocation }) = job.execution else {
            panic!("template snapshot")
        };
        assert_eq!(invocation.output, FfmpegOutput::Transparent);
        assert!(
            invocation
                .args
                .windows(2)
                .any(|pair| pair == ["-c:v", codec])
        );
        assert_eq!(invocation.args.last().map(String::as_str), Some(path));
    }
}

#[test]
fn transparent_preset_output_survives_restart_without_owning_files_or_replay() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("音乐 track.wav");
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("output");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some("ffmpeg -i INPUT -vn -c:a pcm_s16le -f wav OUTPUT".into());
    let runtime = engine(preset.clone());
    let mut job = runtime.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Audio,
        JobSource::Manual,
        1.0,
        None,
        preset.id.clone(),
    );
    let output = PathBuf::from(job.output_path.as_deref().expect("bound output"));
    assert!(output.is_absolute());
    let Some(JobExecution::Ffmpeg { invocation }) = &job.execution else {
        panic!("command snapshot")
    };
    assert_eq!(invocation.output, FfmpegOutput::Transparent);
    assert_eq!(invocation.args.last().map(String::as_str), output.to_str());
    let external = directory
        .path()
        .join(format!(".ffui-{}-external.wav", job.id));
    fs::write(&output, b"user-owned output").expect("output");
    fs::write(&external, b"user-owned temporary name").expect("external");
    job.wait_metadata = Some(
        serde_json::from_value(serde_json::json!({
            "tmpOutputPath": external.to_string_lossy(),
        }))
        .expect("metadata"),
    );
    job.status = JobStatus::Processing;
    assert!(worker::collect_job_tmp_cleanup_paths(&job).is_empty());
    let record = crate::ffui_core::JobRecord::from(crate::ffui_core::TranscodeJobLite::from(&job));
    let restored_record = serde_json::from_slice::<crate::ffui_core::JobRecord>(
        &serde_json::to_vec(&record).expect("persist"),
    )
    .expect("load");
    let restored = crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(
        restored_record,
    ));
    assert_eq!(restored.output_path, job.output_path);
    let fresh = engine(preset);
    fresh.inner.state.lock_unpoisoned().presets = Arc::new(Vec::new());
    super::super::super::state::restore_jobs_from_snapshot(
        &fresh.inner,
        crate::ffui_core::QueueState {
            jobs: vec![restored],
        },
    );
    assert_eq!(fresh.resume_startup_auto_paused_jobs(), 0);
    let mut state = fresh.inner.state.lock_unpoisoned();
    assert_eq!(state.jobs[&job.id].output_path, job.output_path);
    assert!(worker::next_job_for_worker_locked(&mut state).is_none());
    assert_eq!(
        fs::read(output).expect("output preserved"),
        b"user-owned output"
    );
    assert_eq!(
        fs::read(external).expect("external preserved"),
        b"user-owned temporary name"
    );
}

#[test]
fn legacy_template_only_records_an_explicit_output_binding() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("input.wav");
    for template in [
        "ffmpeg -i INPUT -f wav OUTPUT",
        "ffmpeg -i INPUT -metadata title=OUTPUT -f null explicit-output",
    ] {
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("legacy");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(template.into());
        let runtime = engine(preset.clone());
        let mut job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Audio,
            JobSource::Manual,
            1.0,
            None,
            preset.id.clone(),
        );
        let bound = job.output_path.clone();
        job.execution = None;
        super::super::super::manual_execution::hydrate_legacy_job_snapshot(
            &mut job,
            &[preset],
            &crate::ffui_core::domain::OutputPolicy::default(),
        );
        assert_eq!(job.output_path, bound);
        assert_eq!(job.output_path.is_some(), template.ends_with(" OUTPUT"));
        assert!(
            matches!(job.execution, Some(JobExecution::Ffmpeg { invocation })
            if invocation.output == FfmpegOutput::Transparent)
        );
    }
}

#[test]
fn forced_template_extension_changes_address_without_rewriting_the_muxer() {
    let directory = tempfile::tempdir().expect("tempdir");
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("mp3");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some("ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT".into());
    let runtime = engine(preset);
    runtime
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = crate::ffui_core::domain::OutputContainerPolicy::Force {
        format: "wav".into(),
    };
    let job = runtime.enqueue_transcode_job(
        directory
            .path()
            .join("input.flac")
            .to_string_lossy()
            .into_owned(),
        JobType::Audio,
        JobSource::Manual,
        1.0,
        None,
        "mp3".into(),
    );
    let path = job.output_path.as_deref().expect("known output");
    assert_eq!(
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("wav")
    );
    let Some(JobExecution::Ffmpeg { invocation }) = job.execution else {
        panic!("transparent snapshot")
    };
    assert_eq!(invocation.output, FfmpegOutput::Transparent);
    assert!(invocation.args.windows(2).any(|pair| pair == ["-f", "mp3"]));
    assert_eq!(invocation.args.last().map(String::as_str), Some(path));
}
