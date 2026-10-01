use std::path::PathBuf;

use super::*;
use crate::ffui_core::domain::FFmpegPreset;

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
            let bytes = fs::read(&output).expect("preset output");
            match case["id"].as_str().expect("id") {
                "aac-copy-video" => {
                    assert_eq!(&bytes[4..8], b"ftyp");
                    let decoded = Command::new(ffmpeg_program())
                        .arg("-i")
                        .arg(&output)
                        .args(["-f", "null", "-"])
                        .stdin(Stdio::null())
                        .output()
                        .expect("decode AAC output");
                    assert!(decoded.status.success());
                    assert!(String::from_utf8_lossy(&decoded.stderr).contains("Audio: aac"));
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
