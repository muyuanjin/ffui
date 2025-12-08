#[cfg(test)]
mod tools_tests_runtime {
    use crate::ffui_core::settings::ExternalToolSettings;
    use crate::ffui_core::tools::runtime_state::{
        LATEST_TOOL_STATUS, mark_download_finished, mark_download_progress, mark_download_started,
    };
    use crate::ffui_core::tools::types::TOOL_DOWNLOAD_STATE;
    use crate::ffui_core::tools::{
        ExternalToolKind, ExternalToolStatus, update_latest_status_snapshot,
    };
    use once_cell::sync::Lazy;
    use std::sync::Mutex;

    static TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    #[test]
    fn tool_status_exposes_download_state_defaults() {
        let _guard = TEST_MUTEX.lock().unwrap();
        use crate::ffui_core::tools::{tool_status, types::TOOL_DOWNLOAD_STATE};

        // Start from a clean runtime state so earlier tests that touched the
        // global download map do not leak into this assertion.
        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }

        // Also clear cached snapshot to avoid leaking in-progress flags from
        // other tests that may have emitted a snapshot previously.
        {
            let mut snapshot = super::super::runtime_state::LATEST_TOOL_STATUS
                .lock()
                .expect("LATEST_TOOL_STATUS lock poisoned");
            snapshot.clear();
        }

        // When no download has been triggered, the runtime fields should be
        // well-formed and defaulted so the frontend can rely on them without
        // extra null checks.
        let settings = ExternalToolSettings {
            ffmpeg_path: None,
            ffprobe_path: None,
            avifenc_path: None,
            auto_download: false,
            auto_update: false,
            downloaded: None,
        };

        let status = tool_status(ExternalToolKind::Ffmpeg, &settings);
        assert!(!status.download_in_progress);
        assert!(status.download_progress.is_none() || status.download_progress == Some(0.0));
        assert!(status.downloaded_bytes.is_none());
        assert!(status.total_bytes.is_none());
        assert!(status.bytes_per_second.is_none());
        assert!(status.last_download_error.is_none());
        assert!(status.last_download_message.is_none());
    }

    #[test]
    fn download_runtime_state_updates_only_the_target_tool_in_latest_snapshot() {
        let _guard = TEST_MUTEX.lock().unwrap();
        // Start from a clean runtime state.
        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }
        {
            let mut snapshot = LATEST_TOOL_STATUS
                .lock()
                .expect("LATEST_TOOL_STATUS lock poisoned");
            snapshot.clear();
        }

        // Seed an initial snapshot where both ffmpeg and ffprobe are idle.
        let base_ffmpeg = ExternalToolStatus {
            kind: ExternalToolKind::Ffmpeg,
            resolved_path: Some("ffmpeg".to_string()),
            source: Some("path".to_string()),
            version: Some("ffmpeg version 6.0".to_string()),
            remote_version: Some("6.0".to_string()),
            update_available: false,
            auto_download_enabled: true,
            auto_update_enabled: true,
            download_in_progress: false,
            download_progress: None,
            downloaded_bytes: None,
            total_bytes: None,
            bytes_per_second: None,
            last_download_error: None,
            last_download_message: None,
        };
        let base_ffprobe = ExternalToolStatus {
            kind: ExternalToolKind::Ffprobe,
            resolved_path: Some("ffprobe".to_string()),
            source: Some("path".to_string()),
            version: Some("ffprobe version 6.0".to_string()),
            remote_version: Some("6.0".to_string()),
            update_available: false,
            auto_download_enabled: true,
            auto_update_enabled: true,
            download_in_progress: false,
            download_progress: None,
            downloaded_bytes: None,
            total_bytes: None,
            bytes_per_second: None,
            last_download_error: None,
            last_download_message: None,
        };
        update_latest_status_snapshot(vec![base_ffmpeg, base_ffprobe]);

        // Start a download for ffmpeg and simulate progress; this should update
        // only the ffmpeg entry in the cached snapshot.
        mark_download_started(
            ExternalToolKind::Ffmpeg,
            "starting auto-download for ffmpeg".to_string(),
        );
        mark_download_progress(ExternalToolKind::Ffmpeg, 1024, Some(2048));

        let snapshot = LATEST_TOOL_STATUS
            .lock()
            .expect("LATEST_TOOL_STATUS lock poisoned")
            .clone();

        let ffmpeg = snapshot
            .iter()
            .find(|s| s.kind == ExternalToolKind::Ffmpeg)
            .expect("ffmpeg status must exist");
        let ffprobe = snapshot
            .iter()
            .find(|s| s.kind == ExternalToolKind::Ffprobe)
            .expect("ffprobe status must exist");

        assert!(
            ffmpeg.download_in_progress,
            "ffmpeg entry must reflect in-progress download state",
        );
        assert!(
            ffmpeg.downloaded_bytes.is_some(),
            "ffmpeg entry must expose downloaded bytes after progress",
        );
        assert!(
            ffmpeg.total_bytes == Some(2048),
            "ffmpeg entry must expose total bytes from progress callback",
        );
        assert!(
            ffmpeg
                .last_download_message
                .as_deref()
                .unwrap_or_default()
                .contains("starting auto-download for ffmpeg"),
            "ffmpeg entry must preserve the last download message",
        );

        assert!(
            !ffprobe.download_in_progress,
            "ffprobe entry must remain idle when only ffmpeg is downloading",
        );
        assert!(
            ffprobe.downloaded_bytes.is_none(),
            "ffprobe entry must not gain download bytes when it is not downloading",
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn remote_version_is_seeded_from_persisted_download_metadata() {
        let _guard = TEST_MUTEX.lock().unwrap();

        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }
        {
            let mut map = super::super::runtime_state::LAST_TOOL_DOWNLOAD
                .lock()
                .expect("LAST_TOOL_DOWNLOAD lock poisoned");
            map.clear();
        }

        let dir = tempfile::tempdir().expect("create temp dir for fake ffmpeg");
        let bin = dir.path().join("ffmpeg");
        {
            let mut f = File::create(&bin).expect("create fake ffmpeg script");
            writeln!(f, "#!/usr/bin/env sh").ok();
            writeln!(f, "if [ \"$1\" = \"-version\" ]; then").ok();
            writeln!(f, "  echo \"ffmpeg version 6.1.1\"").ok();
            writeln!(f, "  exit 0").ok();
            writeln!(f, "fi").ok();
            writeln!(f, "exit 1").ok();
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin).expect("meta").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin, perms).expect("chmod +x");
        }

        let settings = ExternalToolSettings {
            ffmpeg_path: Some(bin.to_string_lossy().into_owned()),
            ffprobe_path: None,
            avifenc_path: None,
            auto_download: false,
            auto_update: false,
            downloaded: Some(DownloadedToolState {
                ffmpeg: Some(DownloadedToolInfo {
                    version: Some("6.1.1".to_string()),
                    tag: Some("b6.1.1".to_string()),
                    source_url: Some("https://example.test/ffmpeg".to_string()),
                    downloaded_at: Some(123),
                }),
                ..DownloadedToolState::default()
            }),
        };

        super::super::runtime_state::hydrate_last_tool_download_from_settings(&settings);

        let status = crate::ffui_core::tools::tool_status(ExternalToolKind::Ffmpeg, &settings);

        assert_eq!(
            status.remote_version.as_deref(),
            Some("6.1.1"),
            "remote version should reuse persisted metadata after restart"
        );
        assert!(
            status
                .version
                .as_deref()
                .unwrap_or_default()
                .contains("6.1.1"),
            "detected local version should be forwarded"
        );
        assert!(
            !status.update_available,
            "persisted remote version matching the local binary must not trigger downgrade prompts"
        );
    }

    #[test]
    fn download_completion_clears_in_progress_and_progress_bar() {
        let _guard = TEST_MUTEX.lock().unwrap();

        // Seed a snapshot so runtime updates have something to merge into.
        {
            let mut snapshot = LATEST_TOOL_STATUS
                .lock()
                .expect("LATEST_TOOL_STATUS lock poisoned");
            snapshot.clear();
            snapshot.push(ExternalToolStatus {
                kind: ExternalToolKind::Ffmpeg,
                resolved_path: Some("ffmpeg".to_string()),
                source: Some("path".to_string()),
                version: Some("ffmpeg version 6.0".to_string()),
                remote_version: Some("6.0".to_string()),
                update_available: true,
                auto_download_enabled: true,
                auto_update_enabled: true,
                download_in_progress: false,
                download_progress: None,
                downloaded_bytes: None,
                total_bytes: None,
                bytes_per_second: None,
                last_download_error: None,
                last_download_message: None,
            });
        }

        mark_download_started(
            ExternalToolKind::Ffmpeg,
            "starting auto-download for ffmpeg".to_string(),
        );
        mark_download_progress(ExternalToolKind::Ffmpeg, 1024, Some(2048));
        mark_download_finished(
            ExternalToolKind::Ffmpeg,
            "auto-download completed for ffmpeg (path: /tmp/ffmpeg)".to_string(),
        );

        let snapshot = LATEST_TOOL_STATUS
            .lock()
            .expect("LATEST_TOOL_STATUS lock poisoned")
            .clone();
        let ffmpeg = snapshot
            .iter()
            .find(|s| s.kind == ExternalToolKind::Ffmpeg)
            .expect("ffmpeg status must exist");

        assert!(
            !ffmpeg.download_in_progress,
            "completion must clear the in-progress flag so the UI can hide the bar"
        );
        assert_eq!(
            ffmpeg.download_progress,
            Some(100.0),
            "completion should surface a 100% progress snapshot"
        );
        assert!(
            ffmpeg
                .last_download_message
                .as_deref()
                .unwrap_or_default()
                .contains("completed"),
            "completion message should reflect the finished state"
        );
    }
}
