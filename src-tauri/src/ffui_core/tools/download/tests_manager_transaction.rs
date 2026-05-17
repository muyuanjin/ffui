#[cfg(test)]
mod tools_tests_transactional_install {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    use super::super::super::resolve::{downloaded_tool_filename, tool_binary_name, tools_dir};
    use super::super::manager::{
        ensure_tool_available, force_download_tool_binary, with_test_download_hook,
        with_test_verify_hook,
    };
    use super::super::transaction::{ToolInstallTransaction, install_verified_staged_binary};
    use crate::ffui_core::settings::ExternalToolSettings;
    use crate::ffui_core::tools::runtime_state::snapshot_download_state;
    use crate::ffui_core::tools::types::{ExternalToolKind, TOOL_DOWNLOAD_STATE};
    use crate::sync_ext::MutexExt;

    fn clean_runtime_download_state() {
        TOOL_DOWNLOAD_STATE.lock_unpoisoned().clear();
    }

    fn downloaded_path_for_test(kind: ExternalToolKind) -> PathBuf {
        tools_dir()
            .expect("resolve tools dir")
            .join(downloaded_tool_filename(tool_binary_name(kind)))
    }

    #[test]
    fn staging_validation_failure_does_not_create_final_binary() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());

        let dest_path = downloaded_path_for_test(ExternalToolKind::Ffmpeg);

        let staging_dir = with_test_verify_hook(
            |_path, _kind, _source| false,
            || {
                let transaction =
                    ToolInstallTransaction::new(ExternalToolKind::Ffmpeg).expect("transaction");
                let staging_dir = transaction.staging_dir.clone();
                let staged_path = transaction.path("ffmpeg-test.bin");
                fs::write(&staged_path, b"bad download").expect("write staged file");

                let err = install_verified_staged_binary(
                    ExternalToolKind::Ffmpeg,
                    &staged_path,
                    &dest_path,
                    |_path, _kind, _source| false,
                )
                .expect_err("invalid staged binary must fail");
                assert!(
                    err.to_string()
                        .contains("failed verification before install"),
                    "unexpected error: {err:#}"
                );
                staging_dir
            },
        );

        assert!(
            !dest_path.exists(),
            "failed staging install must not create final binary"
        );
        assert!(
            !staging_dir.exists(),
            "failed staging install must clean its unique staging directory"
        );
    }

    #[test]
    fn failed_post_install_validation_restores_previous_binary() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());

        let dest_path = downloaded_path_for_test(ExternalToolKind::Ffprobe);
        let parent = dest_path.parent().expect("dest parent");
        fs::create_dir_all(parent).expect("create tools dir");
        fs::write(&dest_path, b"old binary").expect("write old binary");

        let transaction =
            ToolInstallTransaction::new(ExternalToolKind::Ffprobe).expect("transaction");
        let staging_dir = transaction.staging_dir.clone();
        let staged_path = transaction.path("ffprobe-test.bin");
        fs::write(&staged_path, b"new binary").expect("write staged file");

        let staged_for_hook = staged_path.clone();
        let err = install_verified_staged_binary(
            ExternalToolKind::Ffprobe,
            &staged_path,
            &dest_path,
            move |path, _kind, _source| path == staged_for_hook.as_path(),
        )
        .expect_err("post-install validation failure must restore backup");
        assert!(
            err.to_string()
                .contains("failed verification after install"),
            "unexpected error: {err:#}"
        );
        drop(transaction);

        assert_eq!(
            fs::read(&dest_path).expect("read restored binary"),
            b"old binary"
        );
        assert!(
            !dest_path.with_extension("bak").exists(),
            "backup should be moved back after restore"
        );
        assert!(
            !staging_dir.exists(),
            "transaction should clean staging after restore"
        );
    }

    #[test]
    fn successful_install_cleans_staging_and_backup() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());

        let dest_path = downloaded_path_for_test(ExternalToolKind::Avifenc);
        let parent = dest_path.parent().expect("dest parent");
        fs::create_dir_all(parent).expect("create tools dir");
        fs::write(&dest_path, b"old avifenc").expect("write old binary");

        let transaction =
            ToolInstallTransaction::new(ExternalToolKind::Avifenc).expect("transaction");
        let staging_dir = transaction.staging_dir.clone();
        let staged_path = transaction.path("avifenc-test.bin");
        fs::write(&staged_path, b"new avifenc").expect("write staged file");

        install_verified_staged_binary(
            ExternalToolKind::Avifenc,
            &staged_path,
            &dest_path,
            |_path, _kind, _source| true,
        )
        .expect("valid staged binary should install");
        drop(transaction);

        assert_eq!(
            fs::read(&dest_path).expect("read installed binary"),
            b"new avifenc"
        );
        assert!(
            !dest_path.with_extension("bak").exists(),
            "successful install should remove backup"
        );
        assert!(
            !staging_dir.exists(),
            "successful install should clean staging directory"
        );
    }

    #[test]
    fn force_download_finishes_with_complete_runtime_state() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        clean_runtime_download_state();

        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());
        let dest_path = downloaded_path_for_test(ExternalToolKind::Ffmpeg);

        with_test_download_hook(
            {
                let dest_path = dest_path.clone();
                move |_kind| {
                    if let Some(parent) = dest_path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::write(&dest_path, b"downloaded")?;
                    Ok(dest_path.clone())
                }
            },
            || {
                force_download_tool_binary(ExternalToolKind::Ffmpeg)
                    .expect("test download should complete");
            },
        );

        let state = snapshot_download_state(ExternalToolKind::Ffmpeg);
        assert!(!state.in_progress);
        assert_eq!(state.progress, Some(100.0));
        assert_eq!(state.downloaded_bytes, Some(1));
        assert_eq!(state.total_bytes, Some(1));
    }

    #[test]
    fn failed_download_preserves_existing_binary_and_marks_error() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        clean_runtime_download_state();

        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());
        let dest_path = downloaded_path_for_test(ExternalToolKind::Ffmpeg);
        let parent = dest_path.parent().expect("dest parent");
        fs::create_dir_all(parent).expect("create tools dir");
        fs::write(&dest_path, b"old binary").expect("write old binary");

        with_test_download_hook(
            |_kind| Err(anyhow::anyhow!("simulated download failure")),
            || {
                force_download_tool_binary(ExternalToolKind::Ffmpeg)
                    .expect_err("test download should fail");
            },
        );

        assert_eq!(
            fs::read(&dest_path).expect("read preserved binary"),
            b"old binary"
        );
        let state = snapshot_download_state(ExternalToolKind::Ffmpeg);
        assert!(!state.in_progress);
        assert!(
            state
                .last_error
                .as_deref()
                .is_some_and(|msg| msg.contains("simulated download failure"))
        );
    }

    #[test]
    fn concurrent_ensure_downloads_same_tool_once_and_reuses_installed_binary() {
        let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
            .lock()
            .unwrap();
        clean_runtime_download_state();

        let tmp_root = tempfile::tempdir().expect("temp data root");
        let _root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(tmp_root.path().into());
        let _env_lock = crate::test_support::env_lock();
        let _env_guard = crate::test_support::EnvVarGuard::capture(["PATH"]);
        crate::test_support::set_env("PATH", "");

        let dest_path = downloaded_path_for_test(ExternalToolKind::Ffprobe);
        let download_count = Arc::new(AtomicUsize::new(0));
        let ready = Arc::new(Barrier::new(5));

        with_test_verify_hook(
            {
                let dest_path = dest_path.clone();
                move |path, _kind, source| {
                    source == "download" && path == dest_path.as_path() && path.exists()
                }
            },
            || {
                with_test_download_hook(
                    {
                        let dest_path = dest_path.clone();
                        let download_count = download_count.clone();
                        move |_kind| {
                            download_count.fetch_add(1, Ordering::SeqCst);
                            std::thread::sleep(Duration::from_millis(150));
                            if let Some(parent) = dest_path.parent() {
                                fs::create_dir_all(parent)?;
                            }
                            fs::write(&dest_path, b"downloaded once")?;
                            Ok(dest_path.clone())
                        }
                    },
                    || {
                        let settings = ExternalToolSettings {
                            ffmpeg_path: None,
                            ffprobe_path: None,
                            avifenc_path: None,
                            auto_download: true,
                            auto_update: false,
                            downloaded: None,
                            remote_version_cache: None,
                            probe_cache: None,
                        };

                        let handles: Vec<_> = (0..4)
                            .map(|_| {
                                let settings = settings.clone();
                                let ready = ready.clone();
                                std::thread::spawn(move || {
                                    ready.wait();
                                    ensure_tool_available(ExternalToolKind::Ffprobe, &settings)
                                        .expect("ensure should use downloaded binary")
                                })
                            })
                            .collect();
                        ready.wait();

                        let results: Vec<_> = handles
                            .into_iter()
                            .map(|handle| handle.join().expect("ensure thread"))
                            .collect();

                        assert_eq!(
                            download_count.load(Ordering::SeqCst),
                            1,
                            "only one concurrent ensure should perform the install"
                        );
                        assert_eq!(
                            results.iter().filter(|(_, _, did)| *did).count(),
                            1,
                            "only the installing caller should report did_download=true"
                        );
                        let expected_path = dest_path.to_string_lossy().into_owned();
                        assert!(
                            results
                                .iter()
                                .all(|(path, source, _)| path == &expected_path
                                    && source == "download"),
                            "all callers should reuse the installed downloaded binary"
                        );
                    },
                );
            },
        );
    }
}
