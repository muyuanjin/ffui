#[cfg(test)]
mod tools_tests {
    use std::env;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn verify_tool_binary_handles_tools_that_fail_on_long_version_flag() {
        use crate::ffui_core::tools::{ExternalToolKind, probe::verify_tool_binary};

        let dir = env::temp_dir();

        #[cfg(windows)]
        {
            let path = dir.join("fake_ffmpeg.bat");
            let mut file = File::create(&path).expect("create fake ffmpeg .bat");
            writeln!(file, "@echo off").unwrap();
            writeln!(file, "if \"%1\"==\"--version\" exit /b 8").unwrap();
            writeln!(file, "if \"%1\"==\"-version\" exit /b 0").unwrap();
            writeln!(file, "exit /b 1").unwrap();
            drop(file);

            assert!(verify_tool_binary(
                path.to_string_lossy().as_ref(),
                ExternalToolKind::Ffmpeg,
                "path"
            ));
            let _ = fs::remove_file(&path);
        }

        #[cfg(not(windows))]
        {
            let path = dir.join("fake_ffmpeg.sh");
            let mut file = File::create(&path).expect("create fake ffmpeg script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "if [ \"$1\" = \"--version\" ]; then exit 8; fi").unwrap();
            writeln!(file, "if [ \"$1\" = \"-version\" ]; then exit 0; fi").unwrap();
            writeln!(file, "exit 1").unwrap();
            drop(file);

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&path)
                    .expect("read permissions for fake ffmpeg script")
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&path, perms).expect("mark fake ffmpeg script as executable");
            }

            assert!(verify_tool_binary(
                path.to_string_lossy().as_ref(),
                ExternalToolKind::Ffmpeg,
                "path"
            ));
            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn should_mark_update_available_based_on_version_mismatch() {
        use crate::ffui_core::tools::{
            probe::should_mark_update_available, types::FFMPEG_STATIC_VERSION,
        };

        // Mismatched local/remote versions should be considered updatable.
        let local = Some("ffmpeg version 4.0.0");
        let remote = Some(FFMPEG_STATIC_VERSION);
        assert!(
            should_mark_update_available("path", local, remote),
            "tools should be considered updatable when the local version string does not contain the remote version"
        );

        // When the local version already contains the remote version token, no
        // update should be reported.
        let same_local = format!("ffmpeg version {FFMPEG_STATIC_VERSION}");
        assert!(
            !should_mark_update_available("path", Some(&same_local), remote),
            "when local version already contains the remote version, update_available must be false"
        );

        // Missing version information should not produce false positives.
        assert!(
            !should_mark_update_available("path", None, remote),
            "missing local version must not be treated as needing an update"
        );
        assert!(
            !should_mark_update_available("path", local, None),
            "missing remote version must not be treated as needing an update"
        );
    }

    #[test]
    fn semantic_version_from_tag_strips_non_numeric_prefix() {
        use crate::ffui_core::tools::download::semantic_version_from_tag;

        assert_eq!(semantic_version_from_tag("b6.0"), "6.0");
        assert_eq!(semantic_version_from_tag("v5.1.2"), "5.1.2");
        assert_eq!(semantic_version_from_tag("7.0"), "7.0");
        // If there is no digit at all, we currently return the whole tag.
        assert_eq!(semantic_version_from_tag("nightly"), "nightly");
    }

    #[test]
    fn tool_status_exposes_download_state_defaults() {
        use crate::ffui_core::tools::{ExternalToolKind, tool_status, types::TOOL_DOWNLOAD_STATE};

        // Start from a clean runtime state so earlier tests that touched the
        // global download map do not leak into this assertion.
        {
            let mut map = TOOL_DOWNLOAD_STATE
                .lock()
                .expect("TOOL_DOWNLOAD_STATE lock poisoned");
            map.clear();
        }

        // When no download has been triggered, the runtime fields should be
        // well-formed and defaulted so the frontend can rely on them without
        // extra null checks.
        let settings = crate::ffui_core::settings::ExternalToolSettings {
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

}
