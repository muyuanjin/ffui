use std::collections::BTreeSet;

use crate::commands::tools::get_preview_data_url;
use crate::commands::tools::playable_media::select_playable_media_path;

#[test]
fn get_preview_data_url_builds_data_url_prefix() {
    use std::fs;
    use std::time::{
        SystemTime,
        UNIX_EPOCH,
    };

    let tmp_dir = std::env::temp_dir();
    // Write a small dummy JPEG-like payload into the previews directory and
    // ensure the helper returns a data URL with the expected prefix.
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let data_root = tmp_dir.join(format!("ffui_test_data_root_{timestamp}"));
    let data_root_guard = crate::ffui_core::override_data_root_dir_for_tests(data_root);
    let preview_root = crate::commands::tools::preview_root_dir_for_tests();
    let _ = fs::create_dir_all(&preview_root);
    let path = preview_root.join(format!("ffui_test_preview_{timestamp}.jpg"));

    fs::write(&path, b"dummy-preview-bytes").expect("failed to write preview test file");

    let url = get_preview_data_url(path.to_string_lossy().into_owned())
        .expect("preview data url generation must succeed for readable file");

    assert!(
        url.starts_with("data:image/jpeg;base64,"),
        "preview data url must start with JPEG data URL prefix, got: {url}"
    );
    drop(data_root_guard);
}

#[test]
fn select_playable_media_path_prefers_first_existing_candidate() {
    use std::fs;
    use std::time::{
        SystemTime,
        UNIX_EPOCH,
    };

    // Create a temporary file on disk so we can exercise the helper against
    // both missing and existing candidates without relying on any fixed
    // paths on the user's system.
    let tmp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let existing_path = tmp_dir.join(format!("ffui_test_playable_{timestamp}.mp4"));

    fs::write(&existing_path, b"dummy-bytes").expect("failed to write preview candidate");

    let missing_path = existing_path.with_extension("missing.mp4");

    let candidates = vec![
        missing_path.to_string_lossy().into_owned(),
        existing_path.to_string_lossy().into_owned(),
    ];

    let selected = select_playable_media_path(candidates)
        .expect("select_playable_media_path must return Some for existing file");

    assert_eq!(
        selected,
        existing_path.to_string_lossy(),
        "select_playable_media_path must skip missing files and return the first existing candidate"
    );

    let _ = fs::remove_file(&existing_path);
}

#[test]
fn select_playable_media_path_trims_and_picks_existing_file() {
    use std::fs;
    use std::time::{
        SystemTime,
        UNIX_EPOCH,
    };

    let tmp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let existing_path = tmp_dir.join(format!("ffui_test_playable_trim_{timestamp}.mp4"));

    fs::write(&existing_path, b"dummy-bytes").expect("failed to write preview candidate");

    let padded = format!("  {}  ", existing_path.to_string_lossy());

    let selected = select_playable_media_path(vec![padded, " ".to_string()])
        .expect("select_playable_media_path must ignore padding and pick existing file");

    assert_eq!(
        selected,
        existing_path.to_string_lossy(),
        "select_playable_media_path should return the trimmed existing path"
    );

    let _ = fs::remove_file(&existing_path);
}

#[test]
fn select_playable_media_path_falls_back_to_first_non_empty_candidate() {
    use std::time::{
        SystemTime,
        UNIX_EPOCH,
    };

    let tmp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let missing = tmp_dir.join(format!("ffui_test_playable_missing_{timestamp}.mp4"));
    let missing_str = missing.to_string_lossy().into_owned();

    let selected =
        select_playable_media_path(vec![missing_str.clone(), "".to_string(), "  ".to_string()]);

    assert_eq!(
        selected,
        Some(missing_str),
        "even when stat fails the helper should return the first non-empty candidate"
    );
}

#[test]
fn asset_protocol_scope_aligns_with_opener_allowlist_and_ui_fonts() {
    use std::fs;
    use std::path::PathBuf;

    use serde_json::Value;

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

    let tauri_conf_path = manifest_dir.join("tauri.conf.json");
    let tauri_conf_raw =
        fs::read_to_string(&tauri_conf_path).expect("failed to read src-tauri/tauri.conf.json");
    let tauri_conf: Value =
        serde_json::from_str(&tauri_conf_raw).expect("tauri.conf.json must be valid JSON");

    let scope = tauri_conf
        .get("app")
        .and_then(|v| v.get("security"))
        .and_then(|v| v.get("assetProtocol"))
        .and_then(|v| v.get("scope"))
        .and_then(|v| v.as_array())
        .expect("expected app.security.assetProtocol.scope to be an array");

    let scope_set: BTreeSet<String> = scope
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    assert!(
        !scope_set.contains("**") && !scope_set.contains("*"),
        "assetProtocol.scope must not contain a global wildcard: {scope_set:?}"
    );

    let capabilities_path = manifest_dir.join("capabilities").join("default.json");
    let capabilities_raw = fs::read_to_string(&capabilities_path)
        .expect("failed to read src-tauri/capabilities/default.json");
    let capabilities: Value = serde_json::from_str(&capabilities_raw)
        .expect("capabilities/default.json must be valid JSON");

    let permissions = capabilities
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("capabilities/default.json permissions must be an array");

    let opener_allow_paths: BTreeSet<String> = permissions
        .iter()
        .find(|p| p.get("identifier") == Some(&Value::String("opener:allow-open-path".into())))
        .and_then(|p| p.get("allow"))
        .and_then(|v| v.as_array())
        .expect("expected opener:allow-open-path allowlist")
        .iter()
        .filter_map(|entry| {
            entry
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    let mut expected = opener_allow_paths;
    expected.insert("**/*.[tT][tT][fF]".to_string());
    expected.insert("**/*.[oO][tT][fF]".to_string());

    assert_eq!(
        scope_set, expected,
        "assetProtocol.scope must align with opener:allow-open-path (+ ui fonts)"
    );
}
