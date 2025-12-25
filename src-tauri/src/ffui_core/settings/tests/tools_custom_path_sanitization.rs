#[test]
fn auto_managed_settings_clear_custom_path_when_pointing_to_tools_dir_binary() {
    let tmp = tempfile::tempdir().expect("create temp tools dir");
    let tools_dir = tmp.path();
    let expected = tools_dir.join(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });

    let mut tools = super::ExternalToolSettings {
        auto_download: true,
        auto_update: true,
        ffprobe_path: Some(expected.to_string_lossy().into_owned()),
        ..super::ExternalToolSettings::default()
    };

    tools.sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir_for_tests(tools_dir);

    assert!(
        tools.ffprobe_path.is_none(),
        "auto-managed settings must not treat the tools-dir binary as a user CUSTOM override"
    );
}

#[test]
fn manual_mode_preserves_custom_path_even_if_it_points_to_tools_dir_binary() {
    let tmp = tempfile::tempdir().expect("create temp tools dir");
    let tools_dir = tmp.path();
    let expected = tools_dir.join(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    let expected_s = expected.to_string_lossy().into_owned();

    let mut tools = super::ExternalToolSettings {
        auto_download: false,
        auto_update: false,
        ffprobe_path: Some(expected_s.clone()),
        ..super::ExternalToolSettings::default()
    };

    tools.sanitize_custom_paths_for_auto_managed_downloads_with_tools_dir_for_tests(tools_dir);

    assert_eq!(
        tools.ffprobe_path.as_deref(),
        Some(expected_s.as_str()),
        "manual mode must preserve user-provided CUSTOM overrides"
    );
}
