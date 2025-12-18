#[cfg(test)]
mod tools_tests_probe {
    use std::env;
    use std::fs::{
        self,
        File,
    };
    use std::io::Write;

    #[test]
    fn verify_tool_binary_handles_tools_that_fail_on_long_version_flag() {
        use crate::ffui_core::tools::ExternalToolKind;
        use crate::ffui_core::tools::probe::verify_tool_binary;

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
    fn verify_avifenc_binary_treats_non_zero_exit_as_available() {
        use crate::ffui_core::tools::ExternalToolKind;
        use crate::ffui_core::tools::probe::verify_tool_binary;

        let dir = env::temp_dir();

        #[cfg(windows)]
        {
            let path = dir.join("fake_avifenc.bat");
            let mut file = File::create(&path).expect("create fake avifenc .bat");
            writeln!(file, "@echo off").unwrap();
            // Always exit with a non-zero status so we can verify that the
            // verifier does not rely on the exit code for avifenc.
            writeln!(file, "exit /b 7").unwrap();
            drop(file);

            assert!(
                verify_tool_binary(
                    path.to_string_lossy().as_ref(),
                    ExternalToolKind::Avifenc,
                    "path"
                ),
                "avifenc verifier must treat a successfully spawned binary as available even when it exits non-zero"
            );
            let _ = fs::remove_file(&path);
        }

        #[cfg(not(windows))]
        {
            let path = dir.join("fake_avifenc.sh");
            let mut file = File::create(&path).expect("create fake avifenc script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "exit 7").unwrap();
            drop(file);

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&path)
                    .expect("read permissions for fake avifenc script")
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&path, perms).expect("mark fake avifenc script as executable");
            }

            assert!(
                verify_tool_binary(
                    path.to_string_lossy().as_ref(),
                    ExternalToolKind::Avifenc,
                    "path"
                ),
                "avifenc verifier must treat a successfully spawned binary as available even when it exits non-zero"
            );
            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn tool_status_does_not_spawn_ffmpeg_twice_for_version() {
        use crate::ffui_core::settings::ExternalToolSettings;
        use crate::ffui_core::tools::{
            ExternalToolKind,
            tool_status,
        };

        let dir = tempfile::tempdir().expect("create temp dir for tool_status spawn test");
        let counter_path = dir.path().join("ffui_ffmpeg_spawn_count.txt");

        #[cfg(windows)]
        let script_path = {
            let path = dir.path().join("fake_ffmpeg_counter.bat");
            let mut file = File::create(&path).expect("create fake ffmpeg .bat");
            writeln!(file, "@echo off").unwrap();
            writeln!(file, "echo x>>\"{}\"", counter_path.display()).unwrap();
            writeln!(file, "echo ffmpeg version 9.9.9").unwrap();
            writeln!(file, "exit /b 0").unwrap();
            drop(file);
            path
        };

        #[cfg(not(windows))]
        let script_path = {
            let path = dir.path().join("fake_ffmpeg_counter.sh");
            let mut file = File::create(&path).expect("create fake ffmpeg script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "n=0").unwrap();
            writeln!(
                file,
                "if [ -f \"{}\" ]; then n=$(cat \"{}\" 2>/dev/null || echo 0); fi",
                counter_path.display(),
                counter_path.display()
            )
            .unwrap();
            writeln!(file, "n=$((n+1))").unwrap();
            writeln!(file, "echo \"$n\" > \"{}\"", counter_path.display()).unwrap();
            writeln!(file, "echo \"ffmpeg version 9.9.9\"").unwrap();
            writeln!(file, "exit 0").unwrap();
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

            path
        };

        let settings = ExternalToolSettings {
            ffmpeg_path: Some(script_path.to_string_lossy().into_owned()),
            ..Default::default()
        };

        let status = tool_status(ExternalToolKind::Ffmpeg, &settings);
        assert_eq!(
            status.resolved_path.as_deref(),
            settings.ffmpeg_path.as_deref(),
            "expected tool_status to pick the custom ffmpeg path"
        );

        let count_raw = fs::read_to_string(&counter_path).unwrap_or_default();
        #[cfg(windows)]
        let spawn_count = count_raw.lines().filter(|l| l.trim() == "x").count();
        #[cfg(not(windows))]
        let spawn_count = count_raw.trim().parse::<u32>().unwrap_or(0);

        assert_eq!(
            spawn_count, 1,
            "expected ffmpeg to be spawned exactly once for verify+version"
        );
    }

    #[test]
    fn persisted_probe_cache_avoids_spawning_on_subsequent_startup() {
        use crate::ffui_core::settings::ExternalToolSettings;
        use crate::ffui_core::tools::{
            ExternalToolKind,
            hydrate_probe_cache_from_settings,
            tool_status,
            update_probe_cache_from_statuses,
        };

        crate::ffui_core::tools::probe::reset_probe_cache_for_tests();

        let dir = tempfile::tempdir().expect("create temp dir for probe cache persistence test");
        let counter_path = dir.path().join("ffui_ffmpeg_persist_counter.txt");

        #[cfg(windows)]
        let script_path = {
            let path = dir.path().join("fake_ffmpeg_persist_counter.bat");
            let mut file = File::create(&path).expect("create fake ffmpeg .bat");
            writeln!(file, "@echo off").unwrap();
            writeln!(file, "echo x>>\"{}\"", counter_path.display()).unwrap();
            writeln!(file, "echo ffmpeg version 9.9.9").unwrap();
            writeln!(file, "exit /b 0").unwrap();
            drop(file);
            path
        };

        #[cfg(not(windows))]
        let script_path = {
            let path = dir.path().join("fake_ffmpeg_persist_counter.sh");
            let mut file = File::create(&path).expect("create fake ffmpeg script");
            writeln!(file, "#!/usr/bin/env sh").unwrap();
            writeln!(file, "echo x >> \"{}\"", counter_path.display()).unwrap();
            writeln!(file, "echo \"ffmpeg version 9.9.9\"").unwrap();
            writeln!(file, "exit 0").unwrap();
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

            path
        };

        let settings = ExternalToolSettings {
            ffmpeg_path: Some(script_path.to_string_lossy().into_owned()),
            ..Default::default()
        };

        // First run: probe must spawn once (verify + version) and then be persisted.
        let status = tool_status(ExternalToolKind::Ffmpeg, &settings);
        assert_eq!(
            status.resolved_path.as_deref(),
            settings.ffmpeg_path.as_deref(),
            "expected tool_status to pick the custom ffmpeg path"
        );

        let count_raw = fs::read_to_string(&counter_path).unwrap_or_default();
        let spawn_count = count_raw.lines().filter(|l| l.trim() == "x").count();
        assert_eq!(
            spawn_count, 1,
            "expected ffmpeg to be spawned once on the first run"
        );

        let mut persisted = settings.clone();
        assert!(
            update_probe_cache_from_statuses(&mut persisted, std::slice::from_ref(&status)),
            "expected probe cache to be updated after a successful probe"
        );
        assert!(
            persisted.probe_cache.is_some(),
            "expected persisted.probe_cache to be populated"
        );

        // Second run (simulated restart): hydrate the in-process cache and ensure no spawns happen.
        crate::ffui_core::tools::probe::reset_probe_cache_for_tests();
        hydrate_probe_cache_from_settings(&persisted);

        let status2 = tool_status(ExternalToolKind::Ffmpeg, &persisted);
        assert_eq!(
            status2.resolved_path.as_deref(),
            persisted.ffmpeg_path.as_deref(),
            "expected tool_status to still pick the custom ffmpeg path"
        );

        let count_raw = fs::read_to_string(&counter_path).unwrap_or_default();
        let spawn_count = count_raw.lines().filter(|l| l.trim() == "x").count();
        assert_eq!(
            spawn_count, 1,
            "expected ffmpeg to not be spawned again when the persisted fingerprint matches"
        );
    }
}
