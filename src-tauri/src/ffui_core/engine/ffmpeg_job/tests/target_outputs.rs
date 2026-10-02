use super::*;
use crate::ffui_core::domain::{JobRecord, OutputContainerPolicy, TranscodeJob, TranscodeJobLite};

fn generate_video_with_audio(input: &Path) {
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=16x16:d=0.2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
        ],
        input,
    );
}

#[test]
fn implicit_or_matching_muxers_still_reject_known_image_and_audio_codec_conflicts() {
    for (template, kind, format) in [
        (
            "ffmpeg -i INPUT -an -frames:v 1 -c:v png OUTPUT",
            JobType::Image,
            "bmp",
        ),
        ("ffmpeg -i INPUT -vn -c:a aac OUTPUT", JobType::Audio, "mp3"),
        (
            "ffmpeg -i INPUT -vn -c:a aac -f mp3 OUTPUT",
            JobType::Audio,
            "mp3",
        ),
        (
            "ffmpeg -i INPUT -an -frames:v 1 -c:v png -compression_level 9 -f image2 OUTPUT",
            JobType::Image,
            "bmp",
        ),
        (
            "ffmpeg -i INPUT -loglevel error -vn -c:a aac OUTPUT",
            JobType::Audio,
            "mp3",
        ),
        (
            "ffmpeg -i INPUT -loglevel error -vn -c:a aac -f mp3 OUTPUT",
            JobType::Audio,
            "mp3",
        ),
        (
            "ffmpeg -i INPUT -vn -c:a aac -f mp3 -- OUTPUT",
            JobType::Audio,
            "mp3",
        ),
    ] {
        for container in [
            OutputContainerPolicy::Force {
                format: format.into(),
            },
            OutputContainerPolicy::ByMedia {
                video: None,
                audio: (kind == JobType::Audio).then(|| format.into()),
                image: (kind == JobType::Image).then(|| format.into()),
            },
        ] {
            let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
            preset.advanced_enabled = Some(true);
            preset.output_kind = Some(kind);
            preset.ffmpeg_template = Some(template.into());
            let runtime = engine(preset);
            runtime
                .inner
                .state
                .lock_unpoisoned()
                .settings
                .queue_output_policy
                .container = container;
            let job = runtime.enqueue_transcode_job(
                "input.mp4".into(),
                JobType::Video,
                JobSource::Manual,
                0.0,
                None,
                "target".into(),
            );
            assert!(
                matches!(job.execution, Some(JobExecution::Invalid { ref reason }) if reason.contains("encoder")),
                "{template}: {:?}",
                job.execution
            );
        }
    }
}

#[test]
fn template_muxers_with_additional_options_produce_matching_default_paths_and_media() {
    for (template, extension) in [
        (
            "ffmpeg -i INPUT -loglevel error -vn -c:a libmp3lame -f mp3 OUTPUT",
            "mp3",
        ),
        (
            "ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 -- OUTPUT",
            "mp3",
        ),
        (
            "ffmpeg -i INPUT -an -frames:v 1 -c:v png -compression_level 9 -f image2 OUTPUT",
            "png",
        ),
    ] {
        let directory = tempfile::tempdir().expect("directory");
        let input = directory.path().join("input.mp4");
        generate_video_with_audio(&input);
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(template.into());
        let runtime = engine(preset);
        let job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "target".into(),
        );
        let output = job.output_path.as_ref().expect("output path");
        assert_eq!(Path::new(output).extension().unwrap(), extension);
        assert!(matches!(job.execution, Some(JobExecution::Ffmpeg { .. })));
        process(&runtime, &job.id);
        let completed = runtime.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            completed.status,
            JobStatus::Completed,
            "{:?}",
            completed.failure_reason
        );
        let bytes = fs::read(output).expect("output media");
        assert!(
            if extension == "mp3" {
                bytes.starts_with(b"ID3")
            } else {
                bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            },
            "{template}"
        );
    }
}

#[test]
fn preceding_output_options_do_not_constrain_the_final_output_and_both_files_are_produced() {
    let directory = tempfile::tempdir().expect("directory");
    let input = directory.path().join("input.mp4");
    let side = directory.path().join("side output.mp3");
    generate_video_with_audio(&input);
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
    preset.advanced_enabled = Some(true);
    preset.output_kind = Some(JobType::Other);
    preset.ffmpeg_template = Some(format!(
        "ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 -- \"{}\" -vn -c:a aac OUTPUT",
        side.display()
    ));
    let runtime = engine(preset);
    runtime
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = OutputContainerPolicy::Force {
        format: "mp4".into(),
    };
    let job = runtime.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "target".into(),
    );
    assert!(matches!(job.execution, Some(JobExecution::Ffmpeg { .. })));
    process(&runtime, &job.id);
    let completed = runtime.inner.state.lock_unpoisoned().jobs[&job.id].clone();
    assert_eq!(
        completed.status,
        JobStatus::Completed,
        "{:?}",
        completed.failure_reason
    );
    assert!(fs::read(side).expect("side audio").starts_with(b"ID3"));
    assert_eq!(
        &fs::read(completed.output_path.expect("final output")).expect("final audio")[4..8],
        b"ftyp"
    );
}

#[test]
fn video_input_audio_and_image_presets_use_target_formats_and_persist_resolved_policies() {
    for (template, extension) in [
        ("ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT", "mp3"),
        (
            "ffmpeg -i INPUT -an -frames:v 1 -c:v bmp -f image2 OUTPUT",
            "bmp",
        ),
    ] {
        let directory = tempfile::tempdir().expect("directory");
        let input = directory.path().join("视频 input.mp4");
        generate_video_with_audio(&input);
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(template.into());
        let runtime = engine(preset);
        runtime
            .inner
            .state
            .lock_unpoisoned()
            .settings
            .queue_output_policy
            .container = OutputContainerPolicy::ByMedia {
            video: Some("mkv".into()),
            audio: Some("mp3".into()),
            image: Some("bmp".into()),
        };
        let job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Video,
            JobSource::Manual,
            0.0,
            None,
            "target".into(),
        );
        assert_eq!(
            Path::new(job.output_path.as_deref().expect("output"))
                .extension()
                .and_then(|value| value.to_str()),
            Some(extension)
        );
        let restored: JobRecord = serde_json::from_slice(
            &serde_json::to_vec(&JobRecord::from(TranscodeJobLite::from(&job)))
                .expect("save record"),
        )
        .expect("restore record");
        let restored = TranscodeJob::from(TranscodeJobLite::from(restored));
        assert_eq!(
            restored.output_policy.as_ref().expect("policy").container,
            OutputContainerPolicy::Force {
                format: extension.into()
            }
        );
        runtime
            .inner
            .state
            .lock_unpoisoned()
            .settings
            .queue_output_policy
            .container = OutputContainerPolicy::Force {
            format: "flac".into(),
        };
        process(&runtime, &job.id);
        let completed = runtime.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            completed.status,
            JobStatus::Completed,
            "{:?}",
            completed.failure_reason
        );
        let bytes = fs::read(completed.output_path.expect("output")).expect("produced media");
        if extension == "bmp" {
            assert!(bytes.starts_with(b"BM"));
        } else {
            assert!(bytes.starts_with(b"ID3") || bytes[0] == 0xff);
        }
    }
}

#[test]
fn incompatible_template_format_and_unified_video_to_mp3_have_explicit_invalid_plans() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some("ffmpeg -i INPUT -vn -c:a aac -f mp4 OUTPUT".into());
    let runtime = engine(preset);
    runtime
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = OutputContainerPolicy::ByMedia {
        video: None,
        audio: Some("mp3".into()),
        image: None,
    };
    let job = runtime.enqueue_transcode_job(
        "input.mp4".into(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "target".into(),
    );
    assert!(
        matches!(job.execution, Some(JobExecution::Invalid { ref reason }) if reason.contains("conflicts"))
    );
    let structured = engine(crate::test_support::make_ffmpeg_preset_for_tests("target"));
    structured
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = OutputContainerPolicy::Force {
        format: "mp3".into(),
    };
    let job = structured.enqueue_transcode_job(
        "input.mp4".into(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "target".into(),
    );
    assert!(
        matches!(job.execution, Some(JobExecution::Invalid { ref reason }) if reason.contains("audio-only container"))
    );
}

#[test]
fn keep_input_container_rejects_conflicting_template_muxer() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some("ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT".into());
    let runtime = engine(preset);
    runtime
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = OutputContainerPolicy::KeepInput;
    let job = runtime.enqueue_transcode_job(
        "input.mp4".into(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "target".into(),
    );
    assert!(
        matches!(job.execution, Some(JobExecution::Invalid { ref reason }) if reason.contains("conflicts") && reason.contains("mp3"))
    );
}

#[test]
fn image_extension_aliases_keep_template_parameters_and_valid_plans() {
    for (format, codec) in [("jpeg", "mjpeg"), ("tif", "tiff")] {
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(format!(
            "ffmpeg -i INPUT -frames:v 1 -c:v {codec} -f image2 OUTPUT"
        ));
        let runtime = engine(preset);
        runtime
            .inner
            .state
            .lock_unpoisoned()
            .settings
            .queue_output_policy
            .container = OutputContainerPolicy::Force {
            format: format.into(),
        };
        let job = runtime.enqueue_transcode_job(
            "input.png".into(),
            JobType::Image,
            JobSource::Manual,
            0.0,
            None,
            "target".into(),
        );
        assert!(
            matches!(job.execution, Some(JobExecution::Ffmpeg { ref invocation }) if invocation.args.windows(2).any(|pair| pair == ["-c:v", codec]))
        );
    }
}

#[test]
fn mapped_structured_audio_from_video_uses_managed_execution_without_video_resume() {
    let directory = tempfile::tempdir().expect("directory");
    let input = directory.path().join("input.mp4");
    generate_video_with_audio(&input);
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
    preset.mapping =
        Some(serde_json::from_value(serde_json::json!({"maps": ["0:a:0"]})).expect("mapping"));
    preset.audio.codec = crate::ffui_core::domain::AudioCodecType::Aac;
    let runtime = engine(preset);
    runtime
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_output_policy
        .container = OutputContainerPolicy::ByMedia {
        video: Some("mkv".into()),
        audio: Some("m4a".into()),
        image: None,
    };
    let job = runtime.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "target".into(),
    );
    assert!(matches!(job.execution, Some(JobExecution::Ffmpeg { .. })));
    process(&runtime, &job.id);
    assert_eq!(
        runtime.inner.state.lock_unpoisoned().jobs[&job.id].status,
        JobStatus::Completed
    );
    assert!(Path::new(job.output_path.as_deref().expect("output")).exists());
}
