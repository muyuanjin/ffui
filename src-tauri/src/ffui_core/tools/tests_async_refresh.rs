#[cfg(test)]
mod tools_tests_async_refresh {
    use crate::ffui_core::tools::tests_runtime::TEST_MUTEX;
    use crate::ffui_core::tools::{
        ExternalToolKind,
        ExternalToolStatus,
        finish_tool_status_refresh,
        try_begin_tool_status_refresh,
        ttl_hit,
    };

    #[test]
    fn tool_status_refresh_dedupes_concurrent_requests() {
        let _guard = TEST_MUTEX.lock().unwrap();

        // Ensure a clean starting state for this test.
        finish_tool_status_refresh();

        assert!(
            try_begin_tool_status_refresh(),
            "first refresh attempt should start"
        );
        assert!(
            !try_begin_tool_status_refresh(),
            "second refresh attempt should be deduped"
        );
        finish_tool_status_refresh();
        assert!(
            try_begin_tool_status_refresh(),
            "refresh should be startable again after finishing"
        );
        finish_tool_status_refresh();
    }

    #[test]
    fn ttl_hit_helper_matches_expected_window() {
        let _guard = TEST_MUTEX.lock().unwrap();

        assert!(!ttl_hit(1_000, None, 100));
        assert!(ttl_hit(1_000, Some(950), 100));
        assert!(!ttl_hit(1_000, Some(900), 100));
    }

    #[test]
    fn tool_status_event_payload_contract_is_camelcase() {
        let _guard = TEST_MUTEX.lock().unwrap();

        use serde_json::json;

        let status = ExternalToolStatus {
            kind: ExternalToolKind::Ffmpeg,
            resolved_path: Some("ffmpeg".to_string()),
            source: Some("path".to_string()),
            version: Some("ffmpeg version 6.0".to_string()),
            remote_version: Some("6.1.1".to_string()),
            update_available: true,
            auto_download_enabled: true,
            auto_update_enabled: true,
            download_in_progress: true,
            download_progress: Some(10.0),
            downloaded_bytes: Some(123),
            total_bytes: Some(456),
            bytes_per_second: Some(789.0),
            last_download_error: None,
            last_download_message: Some("downloading".to_string()),
        };

        let value = serde_json::to_value(vec![status]).expect("serialize tool status payload");
        let arr = value.as_array().expect("payload must be an array");
        let obj = arr[0]
            .as_object()
            .expect("payload elements must be objects");

        assert!(obj.contains_key("remoteVersion"));
        assert!(obj.contains_key("downloadInProgress"));
        assert!(obj.contains_key("downloadProgress"));

        // Sanity check: snake_case keys should not appear in the event payload.
        assert_eq!(obj.get("remote_version"), None);
        assert_eq!(obj.get("download_in_progress"), None);

        // Also ensure the kind enum is serialized in the expected format.
        assert_eq!(obj.get("kind"), Some(&json!("ffmpeg")));
    }
}
