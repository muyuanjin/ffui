use super::*;
use crate::ffui_core::domain::{AudioCodecType, FfmpegProgress, QueueState, WaitMetadata};
use std::sync::Mutex;

fn taskbar_progress_for_job(
    job: crate::ffui_core::TranscodeJobUiLite,
) -> crate::ffui_core::TaskbarProgressValue {
    let mut tracker = crate::ffui_core::TaskbarProgressDeltaTracker::default();
    tracker.reset_from_ui_lite(
        &crate::ffui_core::QueueStateUiLite {
            snapshot_revision: 1,
            latest_delta_revision: 0,
            jobs: vec![job],
        },
        crate::ffui_core::TaskbarProgressMode::BySize,
        crate::ffui_core::TaskbarProgressScope::AllJobs,
    );
    assert_eq!(tracker.base_snapshot_revision(), Some(1));
    tracker.display_progress()
}

fn audio_engine() -> TranscodingEngine {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("audio");
    preset.video.encoder = EncoderType::Copy;
    preset.audio.codec = AudioCodecType::Aac;
    preset.audio.loudness_profile = Some("ebuR128".into());
    preset.container = Some(ContainerConfig {
        format: Some("matroska".into()),
        movflags: None,
    });
    let engine = engine(preset);
    engine
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .tools
        .ffprobe_path = Some(
        if cfg!(target_os = "linux") {
            "/usr/bin/ffprobe"
        } else {
            "ffprobe"
        }
        .into(),
    );
    engine
}

#[test]
fn audio_worker_restores_metadata_and_cover_from_persisted_recipe() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().expect("directory");
    let _root = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        directory.path().to_path_buf(),
    );
    let input = directory.path().join("音楽.mp3");
    let cover_input = directory.path().join("cover.jpg");
    generate(
        &["-f", "lavfi", "-i", "color=c=red:s=32x32", "-frames:v", "1"],
        &cover_input,
    );
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-i",
            cover_input.to_str().expect("cover input"),
            "-map",
            "0:a",
            "-map",
            "1:v",
            "-c:a",
            "libmp3lame",
            "-c:v",
            "copy",
            "-disposition:v",
            "attached_pic",
            "-metadata",
            "title=音楽",
            "-metadata",
            "artist=歌手",
        ],
        &input,
    );
    let engine = audio_engine();
    let snapshots = Arc::new(Mutex::new(Vec::<QueueState>::new()));
    let captured = Arc::clone(&snapshots);
    engine.register_queue_listener(move |snapshot| {
        captured.lock().expect("snapshots").push(snapshot)
    });
    let percentages = Arc::new(Mutex::new(Vec::<f64>::new()));
    let captured = Arc::clone(&percentages);
    engine.register_queue_lite_delta_listener(move |delta| {
        captured
            .lock()
            .expect("percentages")
            .extend(delta.patches.iter().filter_map(|patch| patch.progress));
    });
    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Other,
        JobSource::Manual,
        0.0,
        None,
        "audio".into(),
    );
    let serialized = serde_json::to_string(&job).expect("persist");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.presets = Arc::new(Vec::new());
        state.jobs.insert(
            job.id.clone(),
            serde_json::from_str(&serialized).expect("restore"),
        );
    }
    process(&engine, &job.id);
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        stored.status,
        JobStatus::Completed,
        "{:?}",
        stored.failure_reason
    );
    let info = stored.media_info.as_ref().expect("metadata");
    assert_eq!(info.audio_codec.as_deref(), Some("mp3"));
    let audio = info.audio.as_ref().expect("audio info");
    assert_eq!(audio.sample_rate_hz, Some(44100));
    assert_eq!(audio.title.as_deref(), Some("音楽"));
    assert_eq!(audio.artist.as_deref(), Some("歌手"));
    let cover = Path::new(stored.preview_path.as_deref().expect("cover"));
    assert_eq!(&std::fs::read(cover).expect("jpeg")[..2], &[0xff, 0xd8]);
    assert!(
        snapshots
            .lock()
            .expect("snapshots")
            .iter()
            .flat_map(|snapshot| &snapshot.jobs)
            .any(|job| job.status == JobStatus::Processing
                && job
                    .media_info
                    .as_ref()
                    .is_some_and(|info| info.audio.is_some()))
    );
    let observed = percentages.lock().expect("percentages").clone();
    assert!(observed.iter().all(|percent| *percent < 100.0));
    assert!(engine.ensure_job_preview(&job.id).is_some());
    assert!(cover.exists());
    let output = engine
        .inspect_media(stored.output_path.as_deref().expect("output"))
        .expect("output media");
    let output: serde_json::Value = serde_json::from_str(&output).expect("output metadata");
    assert!(
        output["streams"]
            .as_array()
            .expect("streams")
            .iter()
            .any(|stream| stream["codec_type"] == "audio" && stream["codec_name"] == "aac")
    );
    assert!(
        output["format"]["duration"]
            .as_str()
            .expect("duration")
            .parse::<f64>()
            .expect("seconds")
            >= 2.9
    );
}

#[test]
fn offset_opus_and_vorbis_keep_unknown_totals_and_still_convert() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().expect("directory");
    for (codec, extension) in [("libopus", "opus"), ("libvorbis", "ogg")] {
        let input = directory.path().join(format!("offset.{extension}"));
        generate(
            &[
                "-f",
                "lavfi",
                "-i",
                "sine=duration=4",
                "-af",
                "asetpts=PTS+120/TB",
                "-c:a",
                codec,
            ],
            &input,
        );
        let engine = audio_engine();
        let probe: serde_json::Value = serde_json::from_str(
            &engine
                .inspect_media(input.to_str().expect("input"))
                .expect("probe"),
        )
        .expect("json");
        let start = probe["streams"][0]["start_time"]
            .as_str()
            .expect("start")
            .parse::<f64>()
            .expect("seconds");
        assert!(start > 119.0);
        let measured = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&measured);
        engine.register_queue_lite_delta_listener(move |delta| {
            captured.lock().expect("samples").extend(
                delta
                    .patches
                    .iter()
                    .filter_map(|patch| patch.telemetry.as_ref()?.last_progress_percent),
            );
        });
        let job = engine.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Audio,
            JobSource::Manual,
            0.0,
            None,
            "audio".into(),
        );
        process(&engine, &job.id);
        let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            stored.status,
            JobStatus::Completed,
            "{:?}",
            stored.failure_reason
        );
        assert!(
            stored
                .media_info
                .as_ref()
                .expect("metadata")
                .duration_seconds
                .is_none()
        );
        assert!(measured.lock().expect("samples").is_empty());
        let output: serde_json::Value = serde_json::from_str(
            &engine
                .inspect_media(stored.output_path.as_deref().expect("output"))
                .expect("output probe"),
        )
        .expect("json");
        let duration = output["format"]["duration"]
            .as_str()
            .expect("duration")
            .parse::<f64>()
            .expect("seconds");
        assert!((3.9..4.2).contains(&duration), "{codec}: {duration}");
    }
}

#[test]
fn coverless_audio_and_failed_probe_still_execute_without_video_placeholders() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().expect("directory");
    let input = directory.path().join("plain.wav");
    generate(&["-f", "lavfi", "-i", "sine=duration=0.2"], &input);
    for available in [true, false] {
        let engine = audio_engine();
        let measured = Arc::new(Mutex::new(Vec::<f64>::new()));
        let captured = Arc::clone(&measured);
        engine.register_queue_lite_delta_listener(move |delta| {
            captured.lock().expect("samples").extend(
                delta
                    .patches
                    .iter()
                    .filter_map(|patch| patch.telemetry.as_ref()?.last_progress_percent),
            );
        });
        if !available {
            engine
                .inner
                .state
                .lock_unpoisoned()
                .settings
                .tools
                .ffprobe_path = Some("unavailable-ffprobe".into());
        }
        let job = engine.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Audio,
            JobSource::Manual,
            0.0,
            None,
            "audio".into(),
        );
        process(&engine, &job.id);
        let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            stored.status,
            JobStatus::Completed,
            "{:?}",
            stored.failure_reason
        );
        assert!(stored.preview_path.is_none());
        if available {
            let revision = stored.preview_revision;
            assert!(engine.ensure_job_preview(&job.id).is_none());
            assert!(engine.ensure_job_preview(&job.id).is_none());
            assert_eq!(
                engine.inner.state.lock_unpoisoned().jobs[&job.id].preview_revision,
                revision
            );
        }
        assert_eq!(
            stored.media_info.as_ref().expect("info").audio.is_some(),
            available
        );
        let samples = measured.lock().expect("samples").clone();
        if available {
            assert!(
                samples
                    .iter()
                    .any(|sample| *sample > 0.0 && *sample < 100.0),
                "{samples:?}; {:?}",
                stored.logs
            );
        } else {
            assert!(samples.is_empty());
        }
        std::fs::remove_file(stored.output_path.expect("output")).expect("remove test output");
    }
}

#[test]
fn progress_hints_are_snapshot_owned_and_complex_timelines_do_not_claim_input_duration() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("audio");
    let plan = |preset: &crate::ffui_core::domain::FFmpegPreset| {
        super::super::super::manual_execution::plan_manual_execution(
            Path::new("source.mp3"),
            preset,
            Path::new("output.mkv"),
            &crate::ffui_core::domain::OutputPolicy::default(),
        )
        .expect("recipe")
        .execution
    };
    let JobExecution::Ffmpeg { invocation } = plan(&preset) else {
        panic!("recipe")
    };
    assert_eq!(invocation.progress, Some(FfmpegProgress::InputDuration));
    let mut legacy = serde_json::to_value(&invocation).expect("snapshot");
    legacy.as_object_mut().expect("object").remove("progress");
    assert!(
        serde_json::from_value::<FfmpegInvocation>(legacy)
            .expect("legacy")
            .progress
            .is_none()
    );
    preset.filters.af_chain = Some("atempo=2".into());
    let JobExecution::Ffmpeg { invocation } = plan(&preset) else {
        panic!("recipe")
    };
    assert!(invocation.progress.is_none());
    preset.filters.af_chain = None;
    preset.input = Some(crate::ffui_core::domain::InputTimelineConfig {
        seek_mode: None,
        seek_position: Some("1".into()),
        stream_loop: None,
        input_time_offset: None,
        duration_mode: None,
        duration: None,
        accurate_seek: None,
    });
    let JobExecution::Ffmpeg { invocation } = plan(&preset) else {
        panic!("recipe")
    };
    assert!(invocation.progress.is_none());
}

#[test]
fn measured_progress_does_not_finish_a_job_and_old_attempts_cannot_update_it() {
    let engine = engine(crate::test_support::make_ffmpeg_preset_for_tests("unused"));
    let mut job = crate::test_support::make_transcode_job_for_tests(
        "measured",
        JobStatus::Processing,
        0.0,
        None,
    );
    job.wait_metadata = Some(WaitMetadata {
        last_progress_percent: Some(0.0),
        processed_wall_millis: None,
        processed_seconds: None,
        target_seconds: None,
        progress_epoch: Some(1),
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: None,
        segments: None,
        segment_end_targets: None,
    });
    engine
        .inner
        .state
        .lock_unpoisoned()
        .jobs
        .insert(job.id.clone(), job);
    job_runner::update_ffmpeg_job_progress(
        &engine.inner,
        "measured",
        0,
        Some(120.0),
        "out_time_us=60000000",
    );
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs["measured"].progress,
        50.0
    );
    job_runner::update_ffmpeg_job_progress(
        &engine.inner,
        "measured",
        0,
        Some(120.0),
        "out_time_us=240000000",
    );
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs["measured"].progress,
        99.9
    );
    job_runner::update_ffmpeg_job_progress(
        &engine.inner,
        "measured",
        0,
        Some(120.0),
        "progress=end",
    );
    assert_eq!(
        engine.inner.state.lock_unpoisoned().jobs["measured"].status,
        JobStatus::Processing
    );
    let before = serde_json::to_value(&engine.inner.state.lock_unpoisoned().jobs["measured"])
        .expect("before");
    job_runner::update_ffmpeg_job_progress(
        &engine.inner,
        "measured",
        1,
        Some(120.0),
        "out_time_us=999999999",
    );
    assert_eq!(
        serde_json::to_value(&engine.inner.state.lock_unpoisoned().jobs["measured"])
            .expect("after"),
        before
    );
}

#[test]
fn invalid_audio_timestamps_do_not_authorize_progress_but_a_zero_sample_does() {
    let engine = audio_engine();
    let job = engine.enqueue_transcode_job(
        "source.wav".into(),
        JobType::Audio,
        JobSource::Manual,
        1.0,
        None,
        "audio".into(),
    );
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        worker::next_job_for_worker_locked(&mut state).expect("select");
        state.jobs.get_mut(&job.id).expect("job").wait_metadata = Some(
            serde_json::from_value(serde_json::json!({"progressEpoch": 1})).expect("metadata"),
        );
    }
    let measured = Arc::new(Mutex::new(Vec::<f64>::new()));
    let captured = Arc::clone(&measured);
    engine.register_queue_lite_delta_listener(move |delta| {
        captured.lock().expect("samples").extend(
            delta
                .patches
                .iter()
                .filter_map(|patch| patch.telemetry.as_ref()?.last_progress_percent),
        );
    });
    for line in [
        "size=0 time=N/A",
        "out_time=N/A",
        "out_time_us=N/A",
        "out_time_ms=N/A",
        "size=0 time=-00:00:00.02",
        "out_time_us=-1",
        "size=0 time=00:bad:01",
        "out_time=NaN",
        "    title : time=120",
        "    artist : out_time_us=120000000",
        "    title : frame=100 speed=2.0x",
    ] {
        job_runner::update_ffmpeg_job_progress(&engine.inner, &job.id, 0, Some(120.0), line);
        let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert!(
            stored
                .wait_metadata
                .as_ref()
                .expect("metadata")
                .last_progress_percent
                .is_none(),
            "{line}"
        );
        assert_eq!(stored.progress, 0.0);
        assert_eq!(
            taskbar_progress_for_job(crate::ffui_core::TranscodeJobUiLite::from(&stored)),
            crate::ffui_core::TaskbarProgressValue::Indeterminate
        );
    }
    assert!(measured.lock().expect("samples").is_empty());
    job_runner::update_ffmpeg_job_progress(
        &engine.inner,
        &job.id,
        0,
        Some(120.0),
        "out_time=00:00:00.000000",
    );
    let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(stored.progress, 0.0);
    assert_eq!(
        stored
            .wait_metadata
            .as_ref()
            .expect("metadata")
            .last_progress_percent,
        Some(0.0)
    );
    assert_eq!(*measured.lock().expect("samples"), vec![0.0]);
    assert_eq!(
        taskbar_progress_for_job(crate::ffui_core::TranscodeJobUiLite::from(&stored)),
        crate::ffui_core::TaskbarProgressValue::Determinate(0.0)
    );
}

#[test]
fn audio_metadata_from_real_ffmpeg_stderr_cannot_supply_a_progress_sample() {
    let output = Command::new(ffmpeg_program())
        .args([
            "-hide_banner",
            "-nostdin",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=0.1",
            "-metadata",
            "title=time=120",
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("FFmpeg");
    assert!(output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    let metadata = stderr
        .lines()
        .find(|line| line.contains("title") && line.contains("time=120"))
        .expect("metadata diagnostic");
    assert_eq!(
        super::super::super::ffmpeg_args::parse_ffmpeg_progress_sample(metadata).elapsed_seconds,
        None
    );
    assert!(stderr.split(['\r', '\n']).any(|line| {
        super::super::super::ffmpeg_args::parse_ffmpeg_progress_sample(line)
            .elapsed_seconds
            .is_some()
    }));
}

#[test]
fn recovered_audio_replay_clears_samples_before_processing_snapshot_but_video_keeps_resume_baseline()
 {
    let directory = tempfile::tempdir().expect("directory");
    let temporary = directory.path().join("owned.tmp.mkv");
    std::fs::write(&temporary, b"partial").expect("temporary");
    for (filename, job_type, replay) in [
        ("source.wav", JobType::Audio, true),
        ("source.mp4", JobType::Video, false),
    ] {
        let original = audio_engine();
        let mut job = original.enqueue_transcode_job(
            filename.into(),
            job_type,
            JobSource::Manual,
            1.0,
            None,
            "audio".into(),
        );
        assert_eq!(
            matches!(job.execution, Some(JobExecution::Ffmpeg { .. })),
            replay
        );
        job.status = JobStatus::Processing;
        job.progress = 50.0;
        job.elapsed_ms = Some(1000);
        job.media_info.as_mut().expect("media").duration_seconds = Some(120.0);
        job.wait_metadata = Some(
            serde_json::from_value(serde_json::json!({
                "lastProgressPercent": 50.0, "processedSeconds": 60.0, "targetSeconds": 60.0,
                "lastProgressOutTimeSeconds": 60.0, "lastProgressSpeed": 2.0,
                "lastProgressUpdatedAtMs": 1, "lastProgressFrame": 100, "progressEpoch": 3,
                "processedWallMillis": 1000, "tmpOutputPath": temporary,
            }))
            .expect("metadata"),
        );
        let serialized = serde_json::to_string(&QueueState {
            jobs: vec![job.clone()],
        })
        .expect("persist");
        let restored = audio_engine();
        super::super::super::state::restore_jobs_from_snapshot(
            &restored.inner,
            serde_json::from_str(&serialized).expect("restore"),
        );
        assert!(restored.resume_job(&job.id));
        let stored = {
            let mut state = restored.inner.state.lock_unpoisoned();
            assert_eq!(
                worker::next_job_for_worker_locked(&mut state),
                Some(job.id.clone())
            );
            state.jobs[&job.id].clone()
        };
        assert_eq!(stored.status, JobStatus::Processing);
        let meta = stored.wait_metadata.as_ref().expect("metadata");
        assert_eq!(meta.processed_wall_millis, Some(1000));
        assert_eq!(meta.tmp_output_path.as_deref(), temporary.to_str());
        assert!(temporary.exists());
        let projected = crate::ffui_core::TranscodeJobUiLite::from(&stored);
        if replay {
            assert_eq!(stored.progress, 0.0);
            assert!(meta.last_progress_percent.is_none());
            assert!(meta.processed_seconds.is_none());
            assert!(meta.target_seconds.is_none());
            assert!(meta.last_progress_out_time_seconds.is_none());
            assert!(meta.last_progress_speed.is_none());
            assert!(meta.last_progress_updated_at_ms.is_none());
            assert!(meta.last_progress_frame.is_none());
            assert!(
                projected
                    .wait_metadata
                    .as_ref()
                    .expect("UI metadata")
                    .last_progress_percent
                    .is_none()
            );
            assert_eq!(
                taskbar_progress_for_job(projected),
                crate::ffui_core::TaskbarProgressValue::Indeterminate
            );
        } else {
            assert_eq!(stored.progress, 50.0);
            assert_eq!(meta.last_progress_out_time_seconds, Some(60.0));
            assert_eq!(
                taskbar_progress_for_job(projected),
                crate::ffui_core::TaskbarProgressValue::Determinate(0.5)
            );
        }
    }
}
