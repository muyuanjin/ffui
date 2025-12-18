#[cfg(all(test, not(windows)))]
mod tools_tests_manager {
    use std::env;
    use std::fs::{
        self,
        File,
    };
    use std::io::Write;
    use std::time::Duration;

    use crate::ffui_core::settings::ExternalToolSettings;
    use crate::ffui_core::tools::ensure_tool_available;
    use crate::ffui_core::tools::types::{
        ExternalToolKind,
        TOOL_DOWNLOAD_STATE,
    };

    // 防回归：当 tools 目录下已存在且可通过 -version 验证的二进制时，
    // ensure_tool_available 不应再次下载。
    #[test]
    fn ensure_tool_available_skips_download_when_verified_binary_exists() {
        // 仅在本测试进程内生效：禁用自动下载，这样即便 PATH 值不通过验证
        // 也不会触发网络 I/O（构建环境离线时尤为重要）。
        let settings = ExternalToolSettings {
            ffmpeg_path: None,
            ffprobe_path: None,
            avifenc_path: None,
            auto_download: false,
            auto_update: false,
            downloaded: None,
            remote_version_cache: None,
            probe_cache: None,
        };

        // 在可执行旁的 tools 目录构造一个“下载过的” ffprobe 假二进制。
        // 选择 ffprobe 是为了避免与其它测试对 ffmpeg 的潜在并发。
        let exe = env::current_exe().expect("current_exe");
        let tools_dir = exe.parent().expect("exe dir").join("tools");
        fs::create_dir_all(&tools_dir).expect("mkdir tools");

        let bin = tools_dir.join("ffprobe");

        // 构造一个能通过 verify_tool_binary 的最小脚本/批处理。
        // 注意：在 Linux 上如果文件仍处于写入打开状态，执行会触发 ETXTBSY。
        {
            let mut f = File::create(&bin).expect("create fake ffprobe script");
            writeln!(f, "#!/usr/bin/env sh").ok();
            writeln!(f, "[ \"$1\" = \"-version\" ] && exit 0").ok();
            writeln!(f, "exit 1").ok();
        }
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).expect("meta").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).expect("chmod +x");

        let (path, source, did_download) =
            ensure_tool_available(ExternalToolKind::Ffprobe, &settings)
                .expect("ensure_tool_available should succeed with downloaded candidate");

        assert_eq!(source, "download", "must resolve to downloaded candidate");
        assert_eq!(
            std::path::Path::new(&path),
            bin.as_path(),
            "resolved path should match the fake downloaded binary"
        );
        assert!(
            !did_download,
            "must not trigger a new download when file exists"
        );

        let _ = fs::remove_file(&bin);
    }

    #[test]
    fn aria2c_progress_probe_reports_file_growth() {
        // Serialise with other tests that mutate TOOL_DOWNLOAD_STATE.
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();

        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }

        let tmp = tempfile::tempdir().expect("tempdir");
        let file_path = tmp.path().join("ffmpeg.tmp");

        let (stop, handle) = super::super::spawn_download_size_probe(
            ExternalToolKind::Ffmpeg,
            file_path.clone(),
            Some(10),
        );

        // Simulate aria2c writing bytes in the background (write exactly 4 bytes).
        {
            let mut f = File::create(&file_path).expect("create file");
            f.write_all(b"1234").expect("write");
            f.flush().ok();
        }

        std::thread::sleep(Duration::from_millis(400));

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = handle.join();

        let state = crate::ffui_core::tools::runtime_state::snapshot_download_state(
            ExternalToolKind::Ffmpeg,
        );

        assert_eq!(state.downloaded_bytes, Some(4));
        assert_eq!(state.total_bytes, Some(10));
        assert!((state.progress.unwrap_or_default() - 40.0).abs() < 0.1);
    }
}
