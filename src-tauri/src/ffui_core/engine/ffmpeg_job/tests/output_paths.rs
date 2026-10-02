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
fn incompatible_template_format_has_an_invalid_plan_without_rewriting_the_muxer() {
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
    assert!(
        matches!(job.execution, Some(JobExecution::Invalid { ref reason }) if reason.contains("conflicts") && reason.contains("mp3") && reason.contains("wav"))
    );
    assert!(!Path::new(path).exists());
}
#[test]
fn media_scoped_output_snapshots_execute_without_cross_media_overrides() {
    use crate::ffui_core::domain::{AudioCodecType, OutputContainerPolicy, OutputPolicy};
    for (name, template, expected_extension, magic) in [
        ("视频.mp4", None, "mp4", b"ftyp".as_slice()),
        (
            "音乐.wav",
            Some("ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT"),
            "mp3",
            b"".as_slice(),
        ),
        (
            "图片.png",
            Some("ffmpeg -i INPUT -frames:v 1 -c:v bmp -f image2 OUTPUT"),
            "bmp",
            b"BM".as_slice(),
        ),
    ] {
        let directory = tempfile::tempdir().expect("tempdir");
        let input = directory.path().join(name);
        if expected_extension == "mp4" {
            generate(
                &[
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=16x16",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440",
                    "-t",
                    "0.2",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                ],
                &input,
            );
        } else if expected_extension == "mp3" {
            generate(
                &["-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.1"],
                &input,
            );
        } else {
            generate(
                &["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1"],
                &input,
            );
        }
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("scoped");
        preset.audio.codec = AudioCodecType::Aac;
        preset.container = Some(ContainerConfig {
            format: Some("mp4".into()),
            movflags: None,
        });
        preset.advanced_enabled = Some(template.is_some());
        preset.ffmpeg_template = template.map(str::to_string);
        let runtime = engine(preset);
        let policy = OutputPolicy {
            container: OutputContainerPolicy::ByMedia {
                video: None,
                audio: Some("mp3".into()),
                image: Some("bmp".into()),
            },
            ..OutputPolicy::default()
        };
        {
            let mut state = runtime.inner.state.lock_unpoisoned();
            state.settings.queue_output_policy = policy.clone();
            state.settings.tools.ffprobe_path = Some("ffprobe".into());
        }
        let job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Other,
            JobSource::Manual,
            0.0,
            None,
            "scoped".into(),
        );
        let output = PathBuf::from(job.output_path.as_deref().expect("planned output"));
        assert_eq!(
            output.extension().and_then(|extension| extension.to_str()),
            Some(expected_extension)
        );
        if expected_extension == "mp4" {
            assert!(
                !job.ffmpeg_command
                    .as_deref()
                    .expect("planned command")
                    .contains("-f mp3")
            );
        }
        let record =
            crate::ffui_core::JobRecord::from(crate::ffui_core::TranscodeJobLite::from(&job));
        let record: crate::ffui_core::JobRecord =
            serde_json::from_slice(&serde_json::to_vec(&record).expect("persist snapshot"))
                .expect("restore snapshot");
        let restored =
            crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(record));
        let mut resolved_policy = policy;
        resolved_policy.container = if expected_extension == "mp4" {
            OutputContainerPolicy::Default
        } else {
            OutputContainerPolicy::Force {
                format: expected_extension.into(),
            }
        };
        assert_eq!(restored.output_policy, Some(resolved_policy));
        assert_eq!(
            serde_json::to_value(&restored.execution).expect("execution"),
            serde_json::to_value(&job.execution).expect("original execution")
        );
        {
            let mut state = runtime.inner.state.lock_unpoisoned();
            state.settings.queue_output_policy = OutputPolicy::default();
            state.presets = Arc::new(Vec::new());
            state.jobs.insert(job.id.clone(), restored);
        }
        process(&runtime, &job.id);
        let stored = runtime.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            stored.status,
            JobStatus::Completed,
            "{name}: {:?}",
            stored.failure_reason
        );
        assert_eq!(stored.output_path, job.output_path);
        let bytes = fs::read(&output).expect("produced output");
        assert!(!bytes.is_empty());
        if expected_extension == "mp4" {
            assert_eq!(&bytes[4..8], magic);
        }
        if expected_extension == "bmp" {
            assert!(bytes.starts_with(magic));
        }
        let decoded = Command::new(ffmpeg_program())
            .arg("-i")
            .arg(output)
            .args(["-f", "null", "-"])
            .stdin(Stdio::null())
            .output()
            .expect("decode output");
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        if expected_extension == "mp3" {
            assert!(String::from_utf8_lossy(&decoded.stderr).contains("Audio: mp3"));
        }
    }
}
#[test]
fn resumed_video_preserves_scoped_container_after_snapshot_restore_and_settings_changes() {
    use crate::ffui_core::domain::{AudioCodecType, OutputContainerPolicy, OutputPolicy};
    for (format, audio_codec) in [
        ("mkv", AudioCodecType::Copy),
        ("mkv", AudioCodecType::Aac),
        ("webm", AudioCodecType::Copy),
        ("webm", AudioCodecType::Aac),
    ] {
        let directory = tempfile::tempdir().expect("tempdir");
        let input = directory.path().join("视频 input.mp4");
        generate(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=16x16:r=10",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440",
                "-t",
                "2",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
            ],
            &input,
        );
        let segment = directory.path().join("segment0.mkv");
        generate(
            &[
                "-i",
                input.to_str().expect("path"),
                "-t",
                "0.8",
                "-map",
                "0",
                "-c",
                "copy",
                "-f",
                "matroska",
            ],
            &segment,
        );
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("resumed");
        preset.audio.codec = audio_codec.clone();
        preset.container = Some(ContainerConfig {
            format: Some("mp4".into()),
            movflags: None,
        });
        let runtime = engine(preset.clone());
        runtime
            .inner
            .state
            .lock_unpoisoned()
            .settings
            .queue_output_policy = OutputPolicy {
            container: OutputContainerPolicy::ByMedia {
                video: Some(format.into()),
                audio: Some("mp3".into()),
                image: None,
            },
            ..OutputPolicy::default()
        };
        let mut job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            preset.id.clone(),
        );
        assert!(
            job.output_path
                .as_deref()
                .expect("output")
                .ends_with(".mkv")
        );
        job.status = JobStatus::Paused;
        job.wait_metadata = Some(
            serde_json::from_value(serde_json::json!({
                "processedSeconds": 0.8, "targetSeconds": 0.8,
                "lastProgressOutTimeSeconds": 0.8, "processedWallMillis": 100,
                "tmpOutputPath": segment.to_string_lossy(), "segments": [segment.to_string_lossy()],
                "segmentEndTargets": [0.8]
            }))
            .expect("paused snapshot"),
        );
        let record =
            crate::ffui_core::JobRecord::from(crate::ffui_core::TranscodeJobLite::from(&job));
        let record: crate::ffui_core::JobRecord =
            serde_json::from_slice(&serde_json::to_vec(&record).expect("persist"))
                .expect("restore");
        let restored =
            crate::ffui_core::TranscodeJob::from(crate::ffui_core::TranscodeJobLite::from(record));
        let fresh = engine(preset);
        {
            let mut state = fresh.inner.state.lock_unpoisoned();
            state.presets = Arc::new(Vec::new());
            state.settings.tools.ffprobe_path = Some("ffprobe".into());
            state.settings.queue_output_policy = OutputPolicy::default();
        }
        super::super::super::state::restore_jobs_from_snapshot(
            &fresh.inner,
            crate::ffui_core::QueueState {
                jobs: vec![restored],
            },
        );
        assert!(fresh.resume_job(&job.id));
        process(&fresh, &job.id);
        let stored = fresh.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            stored.status,
            JobStatus::Completed,
            "{format}/{audio_codec:?}: {:?}",
            stored.failure_reason
        );
        assert!(stored.logs.iter().any(|line| line.text.contains("resume:")));
        let output = PathBuf::from(stored.output_path.expect("output"));
        assert!(
            fs::read(&output)
                .expect("output bytes")
                .starts_with(b"\x1a\x45\xdf\xa3")
        );
        let decoded = Command::new(ffmpeg_program())
            .arg("-i")
            .arg(output)
            .args(["-f", "null", "-"])
            .stdin(Stdio::null())
            .output()
            .expect("decode output");
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
    }
}
