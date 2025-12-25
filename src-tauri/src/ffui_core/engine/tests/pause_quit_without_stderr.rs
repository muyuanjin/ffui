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
                .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        }
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
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .filter(|p| is_mock_ffmpeg_exe(p))
            .collect();
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
fn wait_sends_quit_without_needing_stderr_lines() {
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

    let _engine_touch_output = EnvGuard::set("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    let _silent_timeout = EnvGuard::set("FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS", "1000");
    let _engine_progress = EnvGuard::set("FFUI_MOCK_FFMPEG_ENGINE_PROGRESS", "1");

    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("input.mp4");
    std::fs::write(&input, b"").expect("write input");

    let mock_exe = locate_mock_ffmpeg_exe();
    let engine = make_engine_with_preset();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
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

    let selected_id = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state).expect("job must be selectable for worker")
    };
    assert_eq!(selected_id, job.id);

    assert!(
        engine.wait_job(&job.id),
        "wait_job should accept a Processing job"
    );

    std::thread::spawn({
        let inner = engine.inner.clone();
        let job_id = job.id.clone();
        move || process_transcode_job(&inner, &job_id).expect("process_transcode_job")
    })
    .join()
    .expect("worker thread must join");

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state.jobs.get(&job.id).expect("job must exist");
    assert_eq!(
        stored.status,
        JobStatus::Paused,
        "job must be paused even when ffmpeg emits no progress lines"
    );
    assert!(
        stored.wait_metadata.is_some(),
        "wait_metadata should be set when paused"
    );
}
