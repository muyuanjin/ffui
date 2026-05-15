use filetime::{FileTime, set_file_mtime};
use tempfile::tempdir;

use super::*;
use crate::ffui_core::{QueueStateLite, QueueStateLiteDelta};
use std::sync::{Arc, Barrier, Mutex};

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
        patch
            .preview
            .as_ref()
            .and_then(|p| p.preview_path.as_deref()),
        Some(preview_path_str.as_str()),
        "ensure_job_preview delta should include previewPath"
    );
    assert!(
        patch
            .preview
            .as_ref()
            .and_then(|p| p.preview_revision)
            .is_some(),
        "ensure_job_preview delta should include previewRevision"
    );
}

#[test]
fn ensure_job_preview_honours_capture_percent_after_duration_probe() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
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

    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let input = data_root.path().join(format!(
        "input-missing-duration-{}-{nonce}.mp4",
        std::process::id()
    ));
    let input_str = input.to_string_lossy().into_owned();
    let tools = {
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
        job.filename = input_str.clone();
        job.input_path = Some(input_str.clone());
        if let Some(info) = job.media_info.as_mut() {
            info.duration_seconds = None;
        }
        state.jobs.insert(job.id.clone(), job);
        state.settings.tools.clone()
    };

    let probed_duration = crate::ffui_core::probe_video_duration_seconds_best_effort(
        std::path::Path::new(&input_str),
        &tools,
    )
    .expect("mock ffprobe should provide a stable duration for preview seek tests");
    assert!(
        (probed_duration - 100.0).abs() < f64::EPSILON,
        "mock ffprobe should return the configured duration"
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let job = state.jobs.get_mut("job-1").expect("job should exist");
        if let Some(info) = job.media_info.as_mut() {
            info.duration_seconds = Some(probed_duration);
        }
    }

    let regenerated = engine.ensure_job_preview("job-1");
    assert!(
        regenerated.is_some(),
        "ensure_job_preview should succeed with mock ffmpeg"
    );

    let contents = std::fs::read_to_string(&capture_path).expect("read capture file");
    let mut fast_ss_arg: Option<String> = None;
    let mut accurate_ss_arg: Option<String> = None;
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
        let Some(i_pos) = argv.iter().position(|a| a == "-i") else {
            continue;
        };
        if argv.get(i_pos + 1).map(String::as_str) != Some(input_str.as_str()) {
            continue;
        }
        let ss_positions: Vec<usize> = argv
            .iter()
            .enumerate()
            .filter_map(|(idx, value)| (value == "-ss").then_some(idx))
            .collect();
        if ss_positions.len() >= 2 {
            fast_ss_arg = argv.get(ss_positions[0] + 1).cloned();
            accurate_ss_arg = argv.get(ss_positions[1] + 1).cloned();
            break;
        }
    }

    assert_eq!(
        fast_ss_arg.as_deref(),
        Some("47.000"),
        "preview extraction should fast-seek near the 50s target"
    );
    assert_eq!(
        accurate_ss_arg.as_deref(),
        Some("3.000"),
        "preview extraction should accurate-seek the remaining offset after fast seek"
    );

    let ss_positions = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|payload| payload.get("argv").and_then(|v| v.as_array()).cloned())
        .filter_map(|argv| {
            let argv: Vec<String> = argv
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            let i_pos = argv.iter().position(|a| a == "-i")?;
            if argv.get(i_pos + 1).map(String::as_str) != Some(input_str.as_str()) {
                return None;
            }
            let positions: Vec<usize> = argv
                .iter()
                .enumerate()
                .filter_map(|(idx, value)| (value == "-ss").then_some(idx))
                .collect();
            (positions.len() >= 2).then_some((i_pos, positions[0], positions[1]))
        })
        .next();

    assert!(
        ss_positions.is_some_and(|(i_pos, fast_ss_pos, accurate_ss_pos)| {
            fast_ss_pos < i_pos && accurate_ss_pos > i_pos
        }),
        "preview extraction should use fast seek before -i and accurate seek after -i"
    );
}

#[test]
fn ensure_job_preview_variant_accepts_fresh_output_when_source_mtime_is_in_the_future() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        "FFUI_MOCK_FFMPEG_CAPTURE_APPEND",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_CAPTURE_APPEND", "1");

    let data_root = tempdir().expect("create temp data root for future mtime preview test");
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

    let input = data_root.path().join("input-future-mtime.mp4");
    std::fs::write(&input, b"video").expect("write source file");
    let future_time = std::time::SystemTime::now() + std::time::Duration::from_secs(300);
    set_file_mtime(&input, FileTime::from_system_time(future_time))
        .expect("set input mtime into the future");
    let input_str = input.to_string_lossy().into_owned();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.tools.auto_download = false;
        state.settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());

        let mut job = crate::test_support::make_transcode_job_for_tests(
            "job-1",
            JobStatus::Queued,
            0.0,
            Some(1),
        );
        job.filename = input_str.clone();
        job.input_path = Some(input_str.clone());
        if let Some(info) = job.media_info.as_mut() {
            info.duration_seconds = Some(12.0);
        }
        state.jobs.insert(job.id.clone(), job);
    }

    let first = engine
        .ensure_job_preview_variant("job-1", 360)
        .expect("variant preview request should succeed")
        .expect("variant preview request should return a path");
    assert!(
        std::path::Path::new(&first).exists(),
        "variant preview should exist after mock ffmpeg writes it"
    );

    let second = engine
        .ensure_job_preview_variant("job-1", 360)
        .expect("repeated variant preview request should succeed")
        .expect("repeated variant preview request should reuse the path");
    assert_eq!(
        first, second,
        "future source mtimes should not force a different preview path"
    );

    let capture_count = std::fs::read_to_string(&capture_path)
        .expect("read capture file")
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|payload| payload.get("argv").and_then(|v| v.as_array()).cloned())
        .filter_map(|argv| {
            let argv: Vec<String> = argv
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            let i_pos = argv.iter().position(|a| a == "-i")?;
            (argv.get(i_pos + 1).map(String::as_str) == Some(input_str.as_str())).then_some(())
        })
        .count();

    assert_eq!(
        capture_count, 1,
        "a future source mtime should not force ffmpeg to rerun after a successful preview write"
    );
}

#[test]
fn ensure_job_preview_deduplicates_concurrent_ffmpeg_spawns_for_the_same_job() {
    let _env_lock = crate::test_support::env_lock();
    crate::ffui_core::tools::reset_tool_probe_cache_for_tests();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
        "FFUI_MOCK_FFMPEG_CAPTURE_PATH",
        "FFUI_MOCK_FFMPEG_CAPTURE_APPEND",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_CAPTURE_APPEND", "1");

    let data_root = tempdir().expect("create temp data root for concurrent preview test");
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
    let input = data_root.path().join("input-concurrent.mp4");
    let input_str = input.to_string_lossy().into_owned();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings.tools.auto_download = false;
        state.settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());

        let mut job = crate::test_support::make_transcode_job_for_tests(
            "job-1",
            JobStatus::Queued,
            0.0,
            Some(1),
        );
        job.filename = input_str.clone();
        job.input_path = Some(input_str.clone());
        if let Some(info) = job.media_info.as_mut() {
            info.duration_seconds = Some(12.0);
        }
        state.jobs.insert(job.id.clone(), job);
    }

    let barrier = Arc::new(Barrier::new(3));
    let engine_a = engine.clone();
    let barrier_a = barrier.clone();
    let handle_a = std::thread::spawn(move || {
        barrier_a.wait();
        engine_a.ensure_job_preview("job-1")
    });
    let engine_b = engine.clone();
    let barrier_b = barrier.clone();
    let handle_b = std::thread::spawn(move || {
        barrier_b.wait();
        engine_b.ensure_job_preview("job-1")
    });

    barrier.wait();
    let result_a = handle_a
        .join()
        .expect("first ensure_job_preview thread must join successfully");
    let result_b = handle_b
        .join()
        .expect("second ensure_job_preview thread must join successfully");

    assert_eq!(
        result_a, result_b,
        "concurrent ensure requests should resolve to the same preview path"
    );

    let capture_count = std::fs::read_to_string(&capture_path)
        .expect("read capture file")
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|payload| payload.get("argv").and_then(|v| v.as_array()).cloned())
        .filter_map(|argv| {
            let argv: Vec<String> = argv
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            let i_pos = argv.iter().position(|a| a == "-i")?;
            (argv.get(i_pos + 1).map(String::as_str) == Some(input_str.as_str())).then_some(())
        })
        .count();

    assert_eq!(
        capture_count, 1,
        "the backend should spawn ffmpeg only once for concurrent preview requests of the same job"
    );
}
