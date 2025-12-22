use super::*;

fn locate_mock_ffmpeg_exe() -> std::path::PathBuf {
    fn is_mock_ffmpeg_exe(path: &std::path::Path) -> bool {
        if !path.is_file() {
            return false;
        }
        if cfg!(windows) {
            return path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("exe"))
                .unwrap_or(false);
        }
        // On Unix, cargo emits the binary without an extension, while sidecar artifacts
        // (e.g. dep-info `.d`) share the same prefix.
        path.extension().is_none()
    }

    fn find_in_dir(dir: &std::path::Path) -> Option<std::path::PathBuf> {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
                    .unwrap_or(false)
            })
            .filter(|p| is_mock_ffmpeg_exe(p))
            .collect();
        // Prefer the newest build artifact so stale binaries in a shared
        // target-dir (or cached check-all target) don't get picked by accident.
        matches.sort_by(|a, b| {
            let a_m = std::fs::metadata(a).and_then(|m| m.modified()).ok();
            let b_m = std::fs::metadata(b).and_then(|m| m.modified()).ok();
            b_m.cmp(&a_m).then_with(|| a.cmp(b))
        });
        matches.into_iter().next()
    }

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

    // Prefer locating the mock binary next to the current test executable so we
    // work correctly with custom `--target-dir` and non-default profiles.
    if let Ok(current) = std::env::current_exe()
        && let Some(dir) = current.parent()
        && let Some(found) = find_in_dir(dir)
    {
        return found;
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_root = crate_root.join("target");
    let direct_candidates = if cfg!(windows) {
        ["ffui-mock-ffmpeg.exe", "ffui_mock_ffmpeg.exe"]
    } else {
        ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"]
    };

    for profile in ["check-all", "debug", "release"] {
        for exe_name in direct_candidates {
            let direct = target_root.join(profile).join(exe_name);
            if direct.exists() {
                return direct;
            }
        }

        let deps_dir = target_root.join(profile).join("deps");
        if deps_dir.exists()
            && let Some(found) = find_in_dir(&deps_dir)
        {
            return found;
        }
    }

    panic!("unable to locate mock ffmpeg executable in target/(check-all|debug|release)");
}

#[test]
fn wait_defers_remux_until_resume_and_skips_when_marked_noaudio() {
    let _env_lock = lock_mock_ffmpeg_env();

    struct EnvGuard {
        key: &'static str,
        prev: Option<std::ffi::OsString>,
    }
    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var_os(key);
            unsafe { std::env::set_var(key, value) };
            Self { key, prev }
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => unsafe { std::env::set_var(self.key, v) },
                None => unsafe { std::env::remove_var(self.key) },
            }
        }
    }

    // Enable minimal progress emission for engine-driven mock ffmpeg spawns.
    let _engine_progress = EnvGuard::set("FFUI_MOCK_FFMPEG_ENGINE_PROGRESS", "1");
    let _engine_touch_output = EnvGuard::set("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");

    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("input.mp4");
    std::fs::write(&input, b"").expect("write input");

    let mock_exe = locate_mock_ffmpeg_exe();
    let engine = make_engine_with_preset();

    // Configure engine to use the mock binary for both ffmpeg and ffprobe so
    // this test never relies on system tools.
    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        state.settings.tools.ffmpeg_path = Some(mock_exe.to_string_lossy().into_owned());
        state.settings.tools.ffprobe_path = Some(mock_exe.to_string_lossy().into_owned());
        state.settings.tools.auto_download = false;
    }

    let job = engine.enqueue_transcode_job(
        input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        0.0,
        None,
        "preset-1".into(),
    );

    let release_active_slot = |engine: &TranscodingEngine, job_id: &str| {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        let input = state.jobs.get(job_id).map(|j| j.filename.clone());
        state.active_jobs.remove(job_id);
        if let Some(input) = input {
            state.active_inputs.remove(&input);
        }
        state.cancelled_jobs.remove(job_id);
    };

    // --- Pause #1 (fresh run): pause must NOT remux (marker should stay absent).
    let job_id_1 = {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        next_job_for_worker_locked(&mut state).expect("job should be eligible")
    };
    assert_eq!(job_id_1, job.id);
    assert!(engine.wait_job(&job.id), "wait_job should be accepted");
    std::thread::spawn({
        let inner = engine.inner.clone();
        let id = job.id.clone();
        move || process_transcode_job(&inner, &id).expect("process_transcode_job")
    })
    .join()
    .expect("pause #1 thread must join");
    release_active_slot(&engine, &job.id);

    let (seg1, marker1, run_cmd_1) = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state.jobs.get(&job.id).expect("job exists");
        assert_eq!(stored.status, JobStatus::Paused, "job must be paused");
        let seg = stored
            .wait_metadata
            .as_ref()
            .and_then(|m| m.tmp_output_path.as_ref())
            .expect("segment path")
            .to_string();
        let seg_path = std::path::PathBuf::from(&seg);
        (
            seg_path.clone(),
            noaudio_marker_path_for_segment(&seg_path),
            stored.runs.first().map(|r| r.command.clone()),
        )
    };
    assert!(
        seg1.exists(),
        "pause #1 segment should exist on disk (path={}, run_command={run_cmd_1:?})",
        seg1.display(),
    );
    assert!(
        !marker1.exists(),
        "pause should not remux; marker must be absent after pause #1"
    );

    // --- Pause #2 (resumed run): resume path should remux seg1 (marker created),
    // and pause path should mark seg2 as already-audio-free (marker created).
    assert!(
        engine.resume_job(&job.id),
        "resume should accept paused job"
    );
    let job_id_2 = {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        next_job_for_worker_locked(&mut state).expect("job should be eligible again")
    };
    assert_eq!(job_id_2, job.id);
    assert!(
        engine.wait_job(&job.id),
        "wait_job should be accepted (pause #2)"
    );
    std::thread::spawn({
        let inner = engine.inner.clone();
        let id = job.id.clone();
        move || process_transcode_job(&inner, &id).expect("process_transcode_job")
    })
    .join()
    .expect("pause #2 thread must join");
    release_active_slot(&engine, &job.id);

    let (seg2, marker2) = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        let stored = state.jobs.get(&job.id).expect("job exists");
        assert_eq!(stored.status, JobStatus::Paused, "job must be paused");
        let seg = stored
            .wait_metadata
            .as_ref()
            .and_then(|m| m.tmp_output_path.as_ref())
            .expect("segment path")
            .to_string();
        let seg_path = std::path::PathBuf::from(&seg);
        (seg_path.clone(), noaudio_marker_path_for_segment(&seg_path))
    };
    assert!(
        marker1.exists(),
        "resume should normalize prior segment; marker must exist after pause #2"
    );
    assert!(seg2.exists(), "pause #2 segment should exist on disk");
    assert!(
        marker2.exists(),
        "resume-generated segment should be marked audio-free on pause"
    );

    // Seed sentinel contents so we can detect whether a future resume attempts a remux.
    std::fs::write(&seg1, b"sentinel-seg1").expect("write seg1 sentinel");
    std::fs::write(&seg2, b"sentinel-seg2").expect("write seg2 sentinel");

    // --- Pause #3: both segments are already marked noaudio, so resume must not remux them.
    assert!(
        engine.resume_job(&job.id),
        "resume should accept paused job"
    );
    let job_id_3 = {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        next_job_for_worker_locked(&mut state).expect("job should be eligible again")
    };
    assert_eq!(job_id_3, job.id);
    assert!(
        engine.wait_job(&job.id),
        "wait_job should be accepted (pause #3)"
    );
    std::thread::spawn({
        let inner = engine.inner.clone();
        let id = job.id.clone();
        move || process_transcode_job(&inner, &id).expect("process_transcode_job")
    })
    .join()
    .expect("pause #3 thread must join");
    release_active_slot(&engine, &job.id);

    let seg1_after = std::fs::read(&seg1).expect("read seg1");
    let seg2_after = std::fs::read(&seg2).expect("read seg2");
    assert_eq!(
        seg1_after, b"sentinel-seg1",
        "resume #3 must not remux seg1 when marker exists"
    );
    assert_eq!(
        seg2_after, b"sentinel-seg2",
        "resume #3 must not remux seg2 when marker exists"
    );
}
