use tempfile::tempdir;

use super::*;
use crate::ffui_core::{QueueStateLite, QueueStateLiteDelta};
use std::sync::{Arc, Mutex};

fn locate_mock_ffmpeg_exe() -> std::path::PathBuf {
    for key in [
        "CARGO_BIN_EXE_ffui-mock-ffmpeg",
        "CARGO_BIN_EXE_ffui_mock_ffmpeg",
    ] {
        if let Ok(path) = std::env::var(key)
            && !path.trim().is_empty()
        {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe()
        && let Some(deps_dir) = current_exe.parent()
        && deps_dir.exists()
    {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let matches: Vec<std::path::PathBuf> = std::fs::read_dir(deps_dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .filter(|p| {
                if !p.is_file() {
                    return false;
                }
                if cfg!(windows) {
                    return p
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
                }
                !p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
            })
            .collect();

        let mut exe_candidates: Vec<(std::path::PathBuf, Option<std::time::SystemTime>)> = matches
            .into_iter()
            .map(|p| {
                let modified = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok());
                (p, modified)
            })
            .collect();
        exe_candidates.sort_by_key(|(p, modified)| (*modified, p.clone()));
        if let Some((p, _)) = exe_candidates.pop() {
            return p;
        }
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_debug = crate_root.join("target").join("debug");
    let direct = if cfg!(windows) {
        target_debug.join("ffui_mock_ffmpeg.exe")
    } else {
        target_debug.join("ffui_mock_ffmpeg")
    };
    if direct.exists() {
        return direct;
    }

    panic!("unable to locate mock ffmpeg executable (ffui_mock_ffmpeg)");
}

#[test]
fn ensure_job_preview_works_with_mock_ffmpeg_for_waiting_jobs() {
    let _env_lock = crate::test_support::env_lock();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");

    let data_root = tempdir().expect("create temp data root for mock preview test");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let engine = make_engine_with_preset();
    let mock_exe = locate_mock_ffmpeg_exe();

    let snapshots: Arc<Mutex<Vec<QueueStateLite>>> = Arc::new(Mutex::new(Vec::new()));
    let deltas: Arc<Mutex<Vec<QueueStateLiteDelta>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let snapshots = snapshots.clone();
        engine.register_queue_lite_listener(move |snapshot: QueueStateLite| {
            snapshots.lock().unwrap().push(snapshot);
        });
    }
    {
        let deltas = deltas.clone();
        engine.register_queue_lite_delta_listener(move |delta: QueueStateLiteDelta| {
            deltas.lock().unwrap().push(delta);
        });
    }

    let input = data_root.path().join("input.mp4");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());

        let mut job = crate::test_support::make_transcode_job_for_tests(
            "job-1",
            JobStatus::Queued,
            0.0,
            Some(1),
        );
        job.filename = input.to_string_lossy().into_owned();
        job.input_path = Some(input.to_string_lossy().into_owned());
        state.jobs.insert(job.id.clone(), job);
    }

    let regenerated = engine.ensure_job_preview("job-1");
    let preview_path_str = regenerated.expect("ensure_job_preview should produce a preview path");
    let preview_path = std::path::PathBuf::from(&preview_path_str);
    assert!(
        preview_path.exists(),
        "mock ffmpeg should have touched the preview output at {preview_path_str}"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let job = state.jobs.get("job-1").expect("job should still exist");
    assert_eq!(
        job.preview_path.as_deref(),
        Some(preview_path_str.as_str()),
        "job.preview_path should be updated in engine state"
    );
    assert!(
        job.preview_revision > 0,
        "job.preview_revision should bump when preview is generated"
    );

    let snapshot_events = snapshots.lock().unwrap().len();
    assert_eq!(
        snapshot_events, 0,
        "ensure_job_preview should not emit a full queue snapshot"
    );

    let delta_events = deltas.lock().unwrap();
    assert_eq!(
        delta_events.len(),
        1,
        "ensure_job_preview should emit one delta"
    );
    let delta = &delta_events[0];
    assert_eq!(
        delta.patches.len(),
        1,
        "ensure_job_preview should emit a single per-job delta patch"
    );
    let patch = &delta.patches[0];
    assert_eq!(
        patch.id.as_str(),
        "job-1",
        "ensure_job_preview delta should target the preview job id"
    );
    assert_eq!(
        patch.preview_path.as_deref(),
        Some(preview_path_str.as_str()),
        "ensure_job_preview delta should include previewPath"
    );
    assert!(
        patch.preview_revision.is_some(),
        "ensure_job_preview delta should include previewRevision"
    );
}

#[test]
fn ensure_job_preview_honours_capture_percent_when_duration_is_missing() {
    let _env_lock = crate::test_support::env_lock();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        "FFUI_MOCK_FFMPEG_CAPTURE_APPEND",
        "FFUI_MOCK_FFPROBE_FORMAT_DURATION",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_CAPTURE_APPEND", "1");
    crate::test_support::set_env("FFUI_MOCK_FFPROBE_FORMAT_DURATION", "100.0\n");

    let data_root = tempdir().expect("create temp data root for mock preview test");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let capture_path = data_root.path().join("captures.jsonl");
    crate::test_support::set_env(
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        capture_path.to_string_lossy().as_ref(),
    );

    let engine = make_engine_with_preset();
    let mock_exe = locate_mock_ffmpeg_exe();

    let input = data_root.path().join("input-missing-duration.mp4");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.preview_capture_percent = 50;
        state.settings.tools.auto_download = false;
        state.settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());
        state.settings.tools.ffprobe_path = Some(mock_exe.to_string_lossy().into_owned());

        let mut job = crate::test_support::make_transcode_job_for_tests(
            "job-1",
            JobStatus::Queued,
            0.0,
            Some(1),
        );
        job.filename = input.to_string_lossy().into_owned();
        job.input_path = Some(input.to_string_lossy().into_owned());
        if let Some(info) = job.media_info.as_mut() {
            info.duration_seconds = None;
        }
        state.jobs.insert(job.id.clone(), job);
    }

    let regenerated = engine.ensure_job_preview("job-1");
    assert!(
        regenerated.is_some(),
        "ensure_job_preview should succeed with mock ffmpeg"
    );

    let contents = std::fs::read_to_string(&capture_path).expect("read capture file");
    let mut ss_arg: Option<String> = None;
    for line in contents.lines() {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(argv) = payload.get("argv").and_then(|v| v.as_array()) else {
            continue;
        };
        let argv: Vec<String> = argv
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !argv.iter().any(|a| a == "-i") {
            continue;
        }
        if let Some(pos) = argv.iter().position(|a| a == "-ss") {
            if let Some(v) = argv.get(pos + 1) {
                ss_arg = Some(v.clone());
                break;
            }
        }
    }

    assert_eq!(
        ss_arg.as_deref(),
        Some("50.000"),
        "preview extraction should seek to 50% of probed 100s duration"
    );

    let ss_pos = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|payload| payload.get("argv").and_then(|v| v.as_array()).cloned())
        .filter_map(|argv| {
            let argv: Vec<String> = argv
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            if !argv.iter().any(|a| a == "-i") {
                return None;
            }
            let i_pos = argv.iter().position(|a| a == "-i")?;
            let ss_pos = argv.iter().position(|a| a == "-ss")?;
            Some((i_pos, ss_pos))
        })
        .next();

    assert!(
        ss_pos.is_some_and(|(i_pos, ss_pos)| ss_pos > i_pos),
        "preview extraction should use accurate seek (-ss after -i)"
    );
}
