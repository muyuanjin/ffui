use std::path::PathBuf;

use super::*;
use crate::ffui_core::domain::FFmpegPreset;

#[test]
fn image_output_group_addresses_match_real_ffmpeg_contents() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../tests/manual-preset-media-contract.json"
    ))
    .expect("media preset contract");
    for case in contract["imageOutputPlanning"]
        .as_array()
        .expect("image planning cases")
    {
        let directory = tempfile::tempdir().expect("tempdir");
        let input = directory.path().join("图像 input.jpg");
        generate(
            &["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1"],
            &input,
        );
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("image-group");
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(case["template"].as_str().expect("template").replace(
            "SIDE",
            &format!(
                "\"{}\"",
                directory.path().join("side.png").to_string_lossy()
            ),
        ));
        let runtime = engine(preset.clone());
        let job = runtime.enqueue_transcode_job(
            input.to_string_lossy().into_owned(),
            JobType::Image,
            JobSource::Manual,
            1.0,
            None,
            preset.id,
        );
        let output = PathBuf::from(job.output_path.as_deref().expect("known output"));
        assert_eq!(
            output.extension().and_then(|extension| extension.to_str()),
            case["extension"].as_str()
        );
        process(&runtime, &job.id);
        let stored = runtime.inner.state.lock_unpoisoned().jobs[&job.id].clone();
        assert_eq!(
            stored.status,
            JobStatus::Completed,
            "{}: {:?}",
            case["template"],
            stored.failure_reason
        );
        let bytes = fs::read(output).expect("image output");
        match case["extension"].as_str().expect("extension") {
            "png" => assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n"),
            "jpg" => assert_eq!(&bytes[..2], b"\xff\xd8"),
            "bmp" => assert_eq!(&bytes[..2], b"BM"),
            "tiff" => assert!(bytes.starts_with(b"II\x2a\0") || bytes.starts_with(b"MM\0\x2a")),
            other => panic!("unverified extension {other}"),
        }
    }
}

#[test]
fn saved_media_presets_execute_expanded_files_and_folders_without_probe() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../tests/manual-preset-media-contract.json"
    ))
    .expect("media preset fixture");
    for case in contract["cases"].as_array().expect("cases") {
        let directory = tempfile::tempdir().expect("tempdir");
        let input = directory
            .path()
            .join(case["inputName"].as_str().expect("input"));
        let source = directory.path().join("source.wav");
        if case["id"] == "png-resize" {
            generate(
                &["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1"],
                &input,
            );
        } else {
            generate(
                &["-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.1"],
                &source,
            );
            fs::rename(&source, &input).expect("rename source including unknown extension");
        }
        let second = input.with_file_name(format!(
            "second-{}",
            case["inputName"].as_str().expect("input")
        ));
        fs::copy(&input, &second).expect("second file");
        let preset: FFmpegPreset =
            serde_json::from_value(case["preset"].clone()).expect("preset IPC");
        crate::ffui_core::domain::validate_preset_for_save(&preset).expect("save contract");
        let persisted = serde_json::to_string(&preset).expect("persist preset");
        let restored: FFmpegPreset = serde_json::from_str(&persisted).expect("restore preset");
        let engine = engine(restored);
        let files = crate::ffui_core::input_expand::expand_manual_job_inputs(
            &[directory.path().to_string_lossy().into_owned()],
            true,
        );
        assert_eq!(files.skipped, 0);
        assert_eq!(files.accepted.len(), 2);
        let first = engine.enqueue_transcode_job(
            files.accepted[0].clone(),
            JobType::Other,
            JobSource::Manual,
            0.0,
            None,
            preset.id.clone(),
        );
        let bulk = engine.enqueue_transcode_jobs(
            files.accepted[1..].to_vec(),
            JobType::Other,
            JobSource::Manual,
            0.0,
            None,
            preset.id,
        );
        engine.inner.state.lock_unpoisoned().presets = Arc::new(Vec::new());
        for job in std::iter::once(first).chain(bulk) {
            assert!(job.batch_id.is_none());
            let Some(JobExecution::Ffmpeg { ref invocation }) = job.execution else {
                panic!("file-based FFmpeg execution for {}", case["id"]);
            };
            let managed = matches!(invocation.output, FfmpegOutput::ManagedFile { .. });
            assert_eq!(managed, case["executionMode"] == "managedFile");
            let output = PathBuf::from(invocation.args.last().expect("bound OUTPUT"));
            assert_eq!(job.output_path.is_some(), case["knownOutput"] == true);
            assert_eq!(job.output_path.as_deref(), output.to_str());
            let wire = serde_json::to_value(crate::ffui_core::TranscodeJobLite::from(&job))
                .expect("queue IPC");
            assert_eq!(
                wire["outputPath"],
                job.output_path.as_deref().expect("known output")
            );
            let ui_wire = serde_json::to_value(crate::ffui_core::TranscodeJobUiLite::from(&job))
                .expect("queue UI IPC");
            assert_eq!(ui_wire["outputPath"], wire["outputPath"]);
            assert_eq!(
                ui_wire["executionMode"],
                if managed { "managed" } else { "transparent" }
            );
            assert_eq!(
                output.extension().and_then(|value| value.to_str()),
                case["outputExtension"].as_str()
            );
            assert!(
                !invocation
                    .args
                    .iter()
                    .any(|argument| argument == "INPUT" || argument == "OUTPUT")
            );
            process(&engine, &job.id);
            let stored = engine.inner.state.lock_unpoisoned().jobs[&job.id].clone();
            assert_eq!(
                stored.status,
                JobStatus::Completed,
                "{}: {:?}",
                case["id"],
                stored.failure_reason
            );
            assert!(stored.failure_reason.is_none());
            assert_eq!(stored.output_path, job.output_path);
            let bytes = fs::read(&output).expect("preset output");
            match case["id"].as_str().expect("id") {
                "aac-copy-video" | "aac-adts" | "mp3-template" => {
                    if case["id"] == "aac-copy-video" {
                        assert_eq!(&bytes[4..8], b"ftyp");
                    }
                    let decoded = Command::new(ffmpeg_program())
                        .arg("-i")
                        .arg(&output)
                        .args(["-f", "null", "-"])
                        .stdin(Stdio::null())
                        .output()
                        .expect("decode audio output");
                    assert!(decoded.status.success());
                    let codec = if case["id"] == "mp3-template" {
                        "mp3"
                    } else {
                        "aac"
                    };
                    assert!(
                        String::from_utf8_lossy(&decoded.stderr)
                            .contains(&format!("Audio: {codec}"))
                    );
                }
                "pcm-unknown-input" => {
                    assert_eq!(&bytes[..4], b"RIFF");
                    assert_eq!(&bytes[8..12], b"WAVE");
                    assert_eq!(
                        u32::from_le_bytes(bytes[24..28].try_into().expect("sample rate")),
                        22_050
                    );
                }
                "png-resize" => {
                    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
                    assert_eq!(
                        u32::from_be_bytes(bytes[16..20].try_into().expect("width")),
                        8
                    );
                    assert_eq!(
                        u32::from_be_bytes(bytes[20..24].try_into().expect("height")),
                        8
                    );
                }
                other => panic!("unverified fixture {other}"),
            }
        }
    }
}
