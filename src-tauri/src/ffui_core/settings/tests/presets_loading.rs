use super::*;
use crate::ffui_core::settings::{io::write_json_file, presets::default_presets};
use std::{fs, sync::Mutex};

// Guard filesystem-based presets/settings sidecars so tests don't race on the
// same {binary}.presets.json path.
static PRESET_IO_MUTEX: Mutex<()> = Mutex::new(());

#[test]
fn load_presets_provides_defaults_when_file_missing_or_empty() {
    let _guard = PRESET_IO_MUTEX.lock().expect("preset io mutex poisoned");
    // Reconstruct the sidecar path in the same way as executable_sidecar_path.
    let exe = std::env::current_exe().expect("resolve current_exe for test");
    let dir = exe.parent().expect("exe has parent directory");
    let stem = exe
        .file_stem()
        .and_then(|s| s.to_str())
        .expect("exe has valid UTF-8 stem");
    let path = dir.join(format!("{stem}.presets.json"));
    // Ensure we start from a clean state with no presets.json.
    let _ = fs::remove_file(&path);
    let presets = load_presets().expect("load_presets should succeed without file");
    assert!(
        !presets.is_empty(),
        "default_presets should be returned when presets file is missing"
    );
    assert!(
        presets.iter().any(|p| p.id == "p1"),
        "defaults must include Universal 1080p with id 'p1'"
    );
    // If an empty presets.json exists, we should still fall back to defaults.
    fs::write(&path, "[]").expect("write empty presets file");
    let presets2 = load_presets().expect("load_presets should succeed with empty file");
    assert!(
        !presets2.is_empty(),
        "defaults should also be injected when presets.json contains an empty array"
    );
    assert!(
        presets2.iter().any(|p| p.id == "p1"),
        "defaults must still include id 'p1' when file is empty"
    );
    let _ = fs::remove_file(&path);
}

#[test]
fn load_presets_does_not_reinject_builtins_after_user_deletes_them() {
    let _guard = PRESET_IO_MUTEX.lock().expect("preset io mutex poisoned");
    // Reconstruct the sidecar path in the same way as executable_sidecar_path.
    let exe = std::env::current_exe().expect("resolve current_exe for test");
    let dir = exe.parent().expect("exe has parent directory");
    let stem = exe
        .file_stem()
        .and_then(|s| s.to_str())
        .expect("exe has valid UTF-8 stem");
    let path = dir.join(format!("{stem}.presets.json"));
    // Start from a clean state.
    let _ = fs::remove_file(&path);
    // Simulate a user who deleted the built-in "Universal 1080p" preset (p1)
    // and only kept "Archive Master" (p2).
    let mut custom = default_presets();
    custom.retain(|p| p.id != "p1");
    assert!(
        custom.iter().all(|p| p.id != "p1"),
        "fixture must not contain the deleted builtin preset"
    );
    write_json_file(&path, &custom).expect("write custom presets fixture");
    let loaded = load_presets().expect("load_presets should respect user file");
    assert!(
        loaded.iter().all(|p| p.id != "p1"),
        "load_presets must not resurrect deleted builtin presets"
    );
    assert_eq!(
        loaded.len(),
        custom.len(),
        "loaded presets should match the persisted list size when file exists"
    );
    let _ = fs::remove_file(&path);
}

#[test]
fn default_presets_ids_remain_stable_for_onboarding_replacement() {
    let presets = default_presets();
    let ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["p1", "p2"],
        "legacy defaults (p1/p2) must keep stable ids so onboarding can replace them safely"
    );
}
