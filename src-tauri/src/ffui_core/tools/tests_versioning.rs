#[cfg(test)]
mod tools_tests_versioning {
    use crate::ffui_core::tools::ExternalToolKind;
    use crate::ffui_core::tools::tests_runtime::TEST_MUTEX;
    use crate::sync_ext::MutexExt;

    #[test]
    fn effective_remote_version_for_avifenc_has_a_fallback_value() {
        let _guard = TEST_MUTEX.lock().unwrap();

        {
            let mut cache = crate::ffui_core::tools::types::LIBAVIF_RELEASE_CACHE.lock_unpoisoned();
            *cache = None;
        }

        let remote = crate::ffui_core::tools::status::effective_remote_version_for(
            ExternalToolKind::Avifenc,
        );

        assert!(
            remote.is_some(),
            "avifenc should always expose a best-effort remote version hint (fallback when remote unknown)"
        );
    }

    #[test]
    fn should_mark_update_available_prefers_semver_compare_over_substring_match() {
        let _guard = TEST_MUTEX.lock().unwrap();

        // Local has a higher semantic version but does not contain the remote string as a substring.
        // Old substring-based logic would incorrectly claim an update is available.
        assert!(
            !crate::ffui_core::tools::status::should_mark_update_available(
                "path",
                Some("ffmpeg version 6.10.0"),
                Some("6.2.0"),
            ),
            "semver compare should prevent downgrade prompts"
        );
    }

    #[test]
    fn should_mark_update_available_returns_false_when_versions_are_not_comparable() {
        let _guard = TEST_MUTEX.lock().unwrap();

        assert!(
            !crate::ffui_core::tools::status::should_mark_update_available(
                "custom",
                Some("ffmpeg version N-121700-g36e5576a44-20251108"),
                Some("6.1.1"),
            ),
            "non-semver local versions should not be treated as huge semantic versions"
        );
    }
}
