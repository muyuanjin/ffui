use std::process::{Command, Stdio};
use std::sync::Arc;

use super::*;
use crate::ffui_core::domain::{
    ContainerConfig, EncoderType, FfmpegJobRequest, JobExecution, JobSource, JobType,
};
use crate::ffui_core::engine::{TranscodingEngine, job_runner, worker};
use crate::ffui_core::settings::AppSettings;

mod audio_feedback;
mod legacy;
mod managed;
mod preset_files;

fn ffmpeg_program() -> &'static str {
    if cfg!(target_os = "linux") {
        "/usr/bin/ffmpeg"
    } else {
        "ffmpeg"
    }
}

fn engine(preset: crate::ffui_core::domain::FFmpegPreset) -> TranscodingEngine {
    let mut settings = AppSettings::default();
    settings.tools.auto_download = false;
    settings.tools.ffmpeg_path = Some(ffmpeg_program().into());
    settings.tools.ffprobe_path = Some("unavailable-ffprobe-for-command-tests".into());
    TranscodingEngine {
        inner: Arc::new(Inner::new(vec![preset], settings)),
    }
}

fn generate(args: &[&str], output: &Path) {
    let result = Command::new(ffmpeg_program())
        .args(["-y", "-hide_banner", "-loglevel", "error"])
        .args(args)
        .arg(output)
        .stdin(Stdio::null())
        .output()
        .expect("FFmpeg must be installed for media execution tests");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn process(engine: &TranscodingEngine, job_id: &str) {
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        assert_eq!(
            worker::next_job_for_worker_locked(&mut state).as_deref(),
            Some(job_id)
        );
    }
    job_runner::process_transcode_job(&engine.inner, job_id).expect("process command job");
}

#[test]
fn managed_image_publishes_a_larger_output_without_saving_gate() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("图像.png");
    generate(
        &["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1"],
        &input,
    );
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("image");
    preset.video.encoder = EncoderType::Unknown("bmp".into());
    preset.container = Some(ContainerConfig {
        format: Some("bmp".into()),
        movflags: None,
    });
    let engine = engine(preset);
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "image".into(),
    );
    assert_eq!(job.job_type, JobType::Image);
    assert!(matches!(job.execution, Some(JobExecution::Ffmpeg { .. })));
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    let output = Path::new(stored.output_path.as_deref().expect("managed output"));
    assert!(
        fs::metadata(output).expect("output exists").len()
            > fs::metadata(input).expect("input exists").len()
    );
    assert!(stored.wait_metadata.is_none());
    assert_eq!(&fs::read(output).expect("bitmap")[..2], b"BM");
}

#[test]
fn managed_audio_uses_its_snapshot_after_the_preset_is_deleted() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("track.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.1"],
        &input,
    );
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("audio");
    preset.container = Some(ContainerConfig {
        format: Some("wav".into()),
        movflags: None,
    });
    let engine = engine(preset);
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "audio".into(),
    );
    assert_eq!(job.job_type, JobType::Audio);
    engine.inner.state.lock_unpoisoned().presets = Arc::new(Vec::new());
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    assert!(
        fs::metadata(stored.output_path.expect("output"))
            .expect("audio output")
            .len()
            > 0
    );
}

#[test]
fn transparent_multi_input_multi_output_command_needs_no_probe_or_filename() {
    let directory = tempfile::tempdir().expect("tempdir");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let args = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880",
        "-map",
        "0:a",
        "-t",
        "0.1",
        "one.wav",
        "-map",
        "1:a",
        "-t",
        "0.1",
        "two.wav",
    ]
    .map(str::to_string)
    .to_vec();
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Generated tones".into(),
            args: args.clone(),
            working_directory: Some(directory.path().to_string_lossy().into_owned()),
        })
        .expect("enqueue transparent job");
    let Some(JobExecution::Ffmpeg { ref invocation }) = job.execution else {
        panic!("FFmpeg execution")
    };
    assert_eq!(invocation.args, args);
    assert!(job.input_path.is_none());
    assert!(job.output_path.is_none());
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    for name in ["one.wav", "two.wav"] {
        assert!(
            fs::metadata(directory.path().join(name))
                .expect("raw output")
                .len()
                > 0
        );
    }
}

#[test]
fn pasted_complete_command_generates_unicode_output_through_the_queue() {
    let directory = tempfile::tempdir().expect("tempdir");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let args = super::super::manual_execution::parse_ffmpeg_command(
        "ffmpeg -f lavfi -i 'sine=frequency=440:duration=0.1' -progress pipe:2 -c:a pcm_s16le \"音频 输出.wav\"",
    )
    .expect("parse complete command");
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Custom FFmpeg task".into(),
            args: args.clone(),
            working_directory: Some(directory.path().to_string_lossy().into_owned()),
        })
        .expect("enqueue parsed command");
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    let bytes = fs::read(directory.path().join("音频 输出.wav")).expect("generated audio");
    assert!(bytes.len() > 44);
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    let Some(JobExecution::Ffmpeg { invocation }) = stored.execution else {
        panic!("FFmpeg execution")
    };
    assert_eq!(invocation.args, args);
    assert_eq!(invocation.output, FfmpegOutput::Transparent);
}

#[test]
fn enqueue_rejects_media_pipes_after_progress_named_values_without_creating_jobs() {
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    for args in [
        vec![
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.1",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "-progress",
            "-progress",
            "pipe:1",
        ],
        vec!["-i", "-progress", "pipe:1"],
        vec!["--", "-progress", "pipe:2"],
    ] {
        let error = engine
            .enqueue_ffmpeg_job(FfmpegJobRequest {
                name: "Unsupported media pipe".into(),
                args: args.into_iter().map(str::to_string).collect(),
                working_directory: None,
            })
            .expect_err("media pipe must fail before queue creation");
        assert!(error.contains("Media stdin/stdout pipes"));
        assert!(engine.queue_state().jobs.is_empty());
    }
}

#[test]
fn transparent_missing_input_fails_without_deleting_user_outputs() {
    let directory = tempfile::tempdir().expect("tempdir");
    let sentinel = directory.path().join("keep.wav");
    fs::write(&sentinel, b"user-owned").expect("sentinel");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Missing input".into(),
            args: vec!["-i".into(), "not-present.unknown".into(), "keep.wav".into()],
            working_directory: Some(directory.path().to_string_lossy().into_owned()),
        })
        .expect("enqueue");
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(stored.status, JobStatus::Failed);
    assert!(stored.failure_reason.is_some());
    assert_eq!(fs::read(sentinel).expect("sentinel kept"), b"user-owned");
}

#[test]
fn transparent_analysis_completes_without_a_file_artifact() {
    let directory = tempfile::tempdir().expect("tempdir");
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Analysis".into(),
            args: [
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440",
                "-t",
                "0.05",
                "-f",
                "null",
                "ignored",
            ]
            .map(str::to_string)
            .to_vec(),
            working_directory: Some(directory.path().to_string_lossy().into_owned()),
        })
        .expect("enqueue analysis");
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    assert!(stored.output_size_mb.is_none());
    assert!(!directory.path().join("ignored").exists());
}

#[test]
fn transparent_crash_recovery_requires_explicit_restart() {
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let mut job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "External output".into(),
            args: vec!["-version".into()],
            working_directory: None,
        })
        .expect("enqueue");
    job.status = JobStatus::Processing;
    let fresh = self::engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    super::super::state::restore_jobs_from_snapshot(
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
    assert!(fresh.restart_job(&job.id));
    assert_eq!(
        fresh.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Queued
    );
}

#[test]
fn transparent_processing_can_be_cancelled_but_not_waited() {
    let engine = Arc::new(engine(crate::test_support::make_ffmpeg_preset_for_tests(
        "unused",
    )));
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Long analysis".into(),
            args: [
                "-re",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440",
                "-t",
                "10",
                "-f",
                "null",
                "ignored",
            ]
            .map(str::to_string)
            .to_vec(),
            working_directory: None,
        })
        .expect("enqueue");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        worker::next_job_for_worker_locked(&mut state).expect("select");
    }
    let worker_engine = engine.clone();
    let worker_id = job.id.clone();
    let processing = std::thread::spawn(move || {
        job_runner::process_transcode_job(&worker_engine.inner, &worker_id)
    });
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert!(!engine.wait_job(&job.id));
    assert!(engine.cancel_job(&job.id));
    processing.join().expect("join").expect("process");
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(stored.status, JobStatus::Cancelled);
    assert!(stored.failure_reason.is_none());
}

#[test]
fn stale_attempt_lines_do_not_change_logs_or_progress() {
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Analysis".into(),
            args: vec!["-version".into()],
            working_directory: None,
        })
        .expect("enqueue");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        worker::next_job_for_worker_locked(&mut state).expect("select");
        state
            .jobs
            .get_mut(&job.id)
            .expect("job")
            .runs
            .push(crate::ffui_core::JobRun {
                command: "new run".into(),
                logs: Vec::new(),
                started_at_ms: Some(1),
            });
    }
    let before = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    record_line(&engine.inner, &job.id, 0, "old run error time=00:00:10.0");
    let after = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(before.logs.len(), after.logs.len());
    assert_eq!(before.progress, after.progress);
}

#[test]
fn persisted_execution_roundtrip_can_run_without_its_preset() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("track.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.05"],
        &input,
    );
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("audio");
    preset.container = Some(ContainerConfig {
        format: Some("wav".into()),
        movflags: None,
    });
    let engine = engine(preset);
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "audio".into(),
    );
    let record = crate::ffui_core::JobRecord::from(crate::ffui_core::TranscodeJobLite::from(&job));
    let encoded = serde_json::to_vec(&record).expect("persist");
    let record = serde_json::from_slice::<crate::ffui_core::JobRecord>(&encoded).expect("restore");
    let restored =
        crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(record));
    assert_eq!(
        serde_json::to_value(&restored.execution).expect("restored spec"),
        serde_json::to_value(&job.execution).expect("original spec")
    );
    let fresh = self::engine(crate::test_support::make_ffmpeg_preset_for_tests(
        "different",
    ));
    {
        let mut state = fresh.inner.state.lock_unpoisoned();
        state.queue.push_back(restored.id.clone());
        state.jobs.insert(restored.id.clone(), restored);
    }
    process(&fresh, &job.id);
    let stored = fresh.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
}

#[test]
fn progress_end_does_not_complete_a_failed_command_and_stale_completion_is_ignored() {
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let job = engine
        .enqueue_ffmpeg_job(FfmpegJobRequest {
            name: "Analysis".into(),
            args: vec!["-version".into()],
            working_directory: None,
        })
        .expect("enqueue");
    worker::next_job_for_worker_locked(&mut engine.inner.state.lock_unpoisoned()).expect("select");
    record_line(&engine.inner, &job.id, 0, "progress=end");
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Processing
    );
    finish_run(
        &engine.inner,
        &job.id,
        0,
        &FfmpegOutput::Transparent,
        None,
        Err(anyhow::anyhow!("process failed")),
    );
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Failed
    );
    assert!(engine.restart_job(&job.id));
    worker::next_job_for_worker_locked(&mut engine.inner.state.lock_unpoisoned()).expect("select");
    job_runner::log_external_command(&engine.inner, &job.id, "ffmpeg", &["-version".into()]);
    finish_run(
        &engine.inner,
        &job.id,
        0,
        &FfmpegOutput::Transparent,
        None,
        Err(anyhow::anyhow!("stale failure")),
    );
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Processing
    );
}

#[test]
fn ordinary_video_retains_its_video_recipe_after_preset_deletion() {
    let directory = tempfile::tempdir().expect("tempdir");
    let input = directory.path().join("clip.mp4");
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=16x16:d=0.1",
            "-c:v",
            "libx264",
        ],
        &input,
    );
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("video");
    preset.video.encoder = EncoderType::Libx264;
    let engine = engine(preset);
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "video".into(),
    );
    assert!(matches!(job.execution, Some(JobExecution::Video { .. })));
    engine.inner.state.lock_unpoisoned().presets = Arc::new(Vec::new());
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    assert!(Path::new(stored.output_path.as_deref().expect("output")).exists());
}
