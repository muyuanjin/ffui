#[cfg(test)]
mod tools_tests_probe {
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
    fn verify_avifenc_binary_treats_non_zero_exit_as_available() {
        use crate::ffui_core::tools::{ExternalToolKind, probe::verify_tool_binary};

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
}
