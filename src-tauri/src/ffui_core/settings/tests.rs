use super::types::{DEFAULT_UI_SCALE_PERCENT, UiFontFamily};
use super::*;
use crate::ffui_core::settings::{io::write_json_file, presets::default_presets};
use serde_json::{Value, json};
use std::{fs, sync::Mutex};
// Guard filesystem-based presets/settings sidecars so tests don't race on the
// same {binary}.presets.json path.
static PRESET_IO_MUTEX: Mutex<()> = Mutex::new(());

mod tests_selection_bar_pinned;
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
#[test]
fn app_settings_default_uses_preview_capture_percent_25() {
    let settings = AppSettings::default();
    assert_eq!(
        settings.preview_capture_percent, 25,
        "default preview_capture_percent must be 25"
    );
    assert_eq!(
        settings.ui_scale_percent, DEFAULT_UI_SCALE_PERCENT,
        "default ui_scale_percent must match DEFAULT_UI_SCALE_PERCENT"
    );
    assert_eq!(
        settings.ui_font_family,
        UiFontFamily::System,
        "default ui_font_family must be System"
    );
    assert!(
        !settings.developer_mode_enabled,
        "developer_mode_enabled must default to false so devtools stay disabled unless explicitly enabled"
    );
    assert!(
        settings.max_parallel_jobs.is_none(),
        "default max_parallel_jobs must be None so the engine can auto-derive concurrency"
    );
    assert!(
        settings.progress_update_interval_ms.is_none(),
        "default progress_update_interval_ms must be None so the engine can choose a stable default"
    );
    assert_eq!(
        settings.taskbar_progress_mode,
        TaskbarProgressMode::ByEstimatedTime,
        "default taskbar_progress_mode should prefer estimated-time weighting"
    );
    assert_eq!(
        settings.taskbar_progress_scope,
        TaskbarProgressScope::AllJobs,
        "default taskbar_progress_scope must keep legacy behaviour of including completed jobs"
    );
}
#[test]
fn app_settings_serializes_preview_capture_percent_as_camel_case() {
    let settings = AppSettings::default();
    let value = serde_json::to_value(&settings).expect("serialize AppSettings");
    let percent = value
        .get("previewCapturePercent")
        .and_then(Value::as_u64)
        .expect("previewCapturePercent field present as u64");
    assert_eq!(percent, 25);
    // When default_queue_preset_id is None it should be omitted from JSON
    // to keep settings.json minimal.
    assert!(
        value.get("defaultQueuePresetId").is_none(),
        "defaultQueuePresetId should be absent when unset"
    );
    // When max_parallel_jobs is None it should be omitted from JSON so
    // existing settings files remain minimal.
    assert!(
        value.get("maxParallelJobs").is_none(),
        "maxParallelJobs should be absent when unset"
    );

    // When progress_update_interval_ms is None it should be omitted from JSON
    // so existing settings files remain minimal.
    assert!(
        value.get("progressUpdateIntervalMs").is_none(),
        "progressUpdateIntervalMs should be absent when unset"
    );
    // When developer_mode_enabled is false it should be omitted from JSON
    // so existing installations don't gain extra noise in settings.json.
    assert!(
        value.get("developerModeEnabled").is_none(),
        "developerModeEnabled should be absent when false"
    );
    let mode = value
        .get("taskbarProgressMode")
        .and_then(Value::as_str)
        .expect("taskbarProgressMode present as string");
    assert_eq!(
        mode, "byEstimatedTime",
        "taskbarProgressMode must serialize as a camelCase string"
    );
    let scope = value
        .get("taskbarProgressScope")
        .and_then(Value::as_str)
        .expect("taskbarProgressScope present as string");
    assert_eq!(
        scope, "allJobs",
        "taskbarProgressScope must serialize as a camelCase string and default to allJobs"
    );
    // When no tools have been auto-downloaded yet, the nested metadata
    // object should be absent so existing settings.json files stay minimal.
    let tools = value
        .get("tools")
        .and_then(Value::as_object)
        .expect("tools field present as object");
    assert!(
        !tools.contains_key("downloaded"),
        "tools.downloaded should be omitted when no download metadata is recorded"
    );
    // When there is no persisted monitor state, the object should be omitted
    // so settings.json stays minimal.
    assert!(
        value.get("monitor").is_none(),
        "monitor should be absent when unset"
    );
    // When selection_bar_pinned is false it should be omitted so settings.json
    // stays minimal and legacy installs don't gain extra noise.
    assert!(
        value.get("selectionBarPinned").is_none(),
        "selectionBarPinned should be absent when false"
    );
    // When UI appearance values are default, they should be omitted so the
    // settings.json stays minimal.
    assert!(
        value.get("uiScalePercent").is_none(),
        "uiScalePercent should be absent when at default"
    );
    assert!(
        value.get("uiFontSizePercent").is_none(),
        "uiFontSizePercent should be absent when at default"
    );
    assert!(
        value.get("uiFontFamily").is_none(),
        "uiFontFamily should be absent when at default"
    );
    assert!(
        value.get("uiFontName").is_none(),
        "uiFontName should be absent when unset"
    );
    assert!(
        value.get("uiFontDownloadId").is_none(),
        "uiFontDownloadId should be absent when unset"
    );
    assert!(
        value.get("uiFontFilePath").is_none(),
        "uiFontFilePath should be absent when unset"
    );
    assert!(
        value.get("uiFontFileSourceName").is_none(),
        "uiFontFileSourceName should be absent when unset"
    );
}
#[test]
fn app_settings_deserializes_missing_preview_capture_percent_with_default() {
    // Simulate legacy JSON without the new previewCapturePercent field.
    let legacy = json!({
        "tools": {
            "ffmpegPath": null,
            "ffprobePath": null,
            "avifencPath": null,
            "autoDownload": false,
            "autoUpdate": false
        },
        "smartScanDefaults": {
            "minImageSizeKB": 50,
            "minVideoSizeMB": 50,
            "minSavingRatio": 0.95,
            "imageTargetFormat": "avif",
            "videoPresetId": ""
        },
        "maxParallelJobs": 3
    });
    let decoded: AppSettings = serde_json::from_value(legacy)
        .expect("deserialize AppSettings without previewCapturePercent");
    assert_eq!(
        decoded.preview_capture_percent, 25,
        "missing previewCapturePercent must default to 25 for backwards compatibility"
    );
    assert!(
        !decoded.developer_mode_enabled,
        "legacy settings without developerModeEnabled must decode with developer_mode_enabled = false"
    );
    assert_eq!(
        decoded.max_parallel_jobs,
        Some(3),
        "maxParallelJobs must deserialize from camelCase JSON field"
    );
    assert_eq!(
        decoded.taskbar_progress_mode,
        TaskbarProgressMode::ByEstimatedTime,
        "missing taskbarProgressMode must default to ByEstimatedTime for backwards compatibility"
    );
    assert_eq!(
        decoded.taskbar_progress_scope,
        TaskbarProgressScope::AllJobs,
        "missing taskbarProgressScope must default to AllJobs for backwards compatibility"
    );
    // Legacy JSON without progressUpdateIntervalMs should transparently
    // default to None so the engine can apply DEFAULT_PROGRESS_UPDATE_INTERVAL_MS.
    assert!(
        decoded.progress_update_interval_ms.is_none(),
        "legacy settings without progressUpdateIntervalMs must decode with progress_update_interval_ms = None"
    );
    // Legacy JSON without tools.downloaded should transparently default to
    // an empty metadata map.
    assert!(
        decoded.tools.downloaded.is_none(),
        "legacy settings without tools.downloaded must decode with downloaded = None"
    );
}
#[test]
fn app_settings_serializes_ui_appearance_when_non_default() {
    let settings = AppSettings {
        ui_scale_percent: 110,
        ui_font_size_percent: 120,
        ui_font_family: UiFontFamily::Mono,
        ui_font_name: Some("Consolas".to_string()),
        ui_font_download_id: Some("inter".to_string()),
        ui_font_file_path: Some("/tmp/ui-fonts/imported.ttf".to_string()),
        ui_font_file_source_name: Some("MyFont.ttf".to_string()),
        ..AppSettings::default()
    };
    let value = serde_json::to_value(&settings).expect("serialize AppSettings with ui appearance");
    assert_eq!(
        value.get("uiScalePercent").and_then(Value::as_u64),
        Some(110),
        "uiScalePercent should serialize when non-default"
    );
    assert_eq!(
        value.get("uiFontSizePercent").and_then(Value::as_u64),
        Some(120),
        "uiFontSizePercent should serialize when non-default"
    );
    assert_eq!(
        value.get("uiFontFamily").and_then(Value::as_str),
        Some("mono"),
        "uiFontFamily should serialize as a camelCase string"
    );
    assert_eq!(
        value.get("uiFontName").and_then(Value::as_str),
        Some("Consolas"),
        "uiFontName should serialize when set"
    );
    assert_eq!(
        value.get("uiFontDownloadId").and_then(Value::as_str),
        Some("inter"),
        "uiFontDownloadId should serialize when set"
    );
    assert_eq!(
        value.get("uiFontFilePath").and_then(Value::as_str),
        Some("/tmp/ui-fonts/imported.ttf"),
        "uiFontFilePath should serialize when set"
    );
    assert_eq!(
        value.get("uiFontFileSourceName").and_then(Value::as_str),
        Some("MyFont.ttf"),
        "uiFontFileSourceName should serialize when set"
    );

    let decoded: AppSettings =
        serde_json::from_value(value).expect("deserialize AppSettings with ui appearance");
    assert_eq!(decoded.ui_scale_percent, 110);
    assert_eq!(decoded.ui_font_size_percent, 120);
    assert_eq!(decoded.ui_font_family, UiFontFamily::Mono);
    assert_eq!(decoded.ui_font_name.as_deref(), Some("Consolas"));
    assert_eq!(decoded.ui_font_download_id.as_deref(), Some("inter"));
    assert_eq!(
        decoded.ui_font_file_path.as_deref(),
        Some("/tmp/ui-fonts/imported.ttf")
    );
    assert_eq!(
        decoded.ui_font_file_source_name.as_deref(),
        Some("MyFont.ttf")
    );
}

#[test]
fn app_settings_round_trips_downloaded_tool_metadata() {
    let mut settings = AppSettings::default();
    settings.tools.downloaded = Some(DownloadedToolState {
        ffmpeg: Some(DownloadedToolInfo {
            version: Some("6.1".to_string()),
            tag: Some("b6.1".to_string()),
            source_url: Some(
                "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1/ffmpeg-win32-x64"
                    .to_string(),
            ),
            downloaded_at: Some(1_735_000_000_000),
        }),
        ffprobe: None,
        avifenc: None,
    });

    let json = serde_json::to_value(&settings).expect("serialize AppSettings with metadata");
    let tools = json
        .get("tools")
        .and_then(Value::as_object)
        .expect("tools field present as object");
    let downloaded = tools
        .get("downloaded")
        .and_then(Value::as_object)
        .expect("tools.downloaded present when metadata is set");
    let ffmpeg = downloaded
        .get("ffmpeg")
        .and_then(Value::as_object)
        .expect("downloaded.ffmpeg present");

    assert_eq!(ffmpeg.get("version").and_then(Value::as_str), Some("6.1"));
    assert_eq!(ffmpeg.get("tag").and_then(Value::as_str), Some("b6.1"));

    // JSON should deserialize back to the same structure so callers can
    // rely on settings.json as the single source of truth.
    let decoded: AppSettings =
        serde_json::from_value(json).expect("round-trip deserialize AppSettings");
    let decoded_meta = decoded
        .tools
        .downloaded
        .and_then(|state| state.ffmpeg)
        .expect("decoded.tools.downloaded.ffmpeg present");
    assert_eq!(decoded_meta.version.as_deref(), Some("6.1"));
    assert_eq!(decoded_meta.tag.as_deref(), Some("b6.1"));
}

#[test]
fn app_settings_serializes_developer_mode_enabled_when_true() {
    let settings = AppSettings {
        developer_mode_enabled: true,
        ..AppSettings::default()
    };

    let json = serde_json::to_value(&settings).expect("serialize AppSettings with dev mode");
    let dev_mode = json
        .get("developerModeEnabled")
        .and_then(Value::as_bool)
        .expect("developerModeEnabled present when true");
    assert!(
        dev_mode,
        "developerModeEnabled must serialize as true when enabled"
    );

    let decoded: AppSettings =
        serde_json::from_value(json).expect("round-trip deserialize AppSettings with dev mode");
    assert!(
        decoded.developer_mode_enabled,
        "developer_mode_enabled must remain true after round-trip serialization"
    );
}

#[test]
fn default_intervals_match_documented_constants() {
    // Keep engine defaults for progress and metrics intervals stable and
    // discoverable for the frontend (SettingsPanel) so both sides agree on
    // what “默认值” means when fields are left unset.
    assert_eq!(
        DEFAULT_PROGRESS_UPDATE_INTERVAL_MS, 250,
        "DEFAULT_PROGRESS_UPDATE_INTERVAL_MS must remain 250ms unless explicitly coordinated with the frontend",
    );
    assert_eq!(
        DEFAULT_METRICS_INTERVAL_MS, 1_000,
        "DEFAULT_METRICS_INTERVAL_MS must remain 1000ms unless explicitly coordinated with the frontend",
    );
}

#[test]
fn app_settings_round_trips_updater_metadata() {
    use crate::ffui_core::settings::types::AppUpdaterSettings;

    let settings = AppSettings {
        updater: Some(AppUpdaterSettings {
            auto_check: false,
            last_checked_at_ms: Some(1_735_000_000_000),
            available_version: Some("0.2.0".to_string()),
        }),
        ..Default::default()
    };

    let json = serde_json::to_value(&settings).expect("serialize AppSettings with updater");
    let updater = json
        .get("updater")
        .and_then(Value::as_object)
        .expect("updater object should be present when set");

    assert_eq!(
        updater.get("autoCheck").and_then(Value::as_bool),
        Some(false),
        "updater.autoCheck must serialize in camelCase"
    );
    assert_eq!(
        updater.get("lastCheckedAtMs").and_then(Value::as_u64),
        Some(1_735_000_000_000),
        "updater.lastCheckedAtMs must serialize in camelCase"
    );
    assert_eq!(
        updater.get("availableVersion").and_then(Value::as_str),
        Some("0.2.0"),
        "updater.availableVersion must serialize in camelCase"
    );

    let decoded: AppSettings =
        serde_json::from_value(json).expect("round-trip deserialize AppSettings with updater");
    let decoded_updater = decoded.updater.expect("decoded updater present");
    assert!(
        !decoded_updater.auto_check,
        "updater.auto_check must remain false after round-trip"
    );
    assert_eq!(decoded_updater.last_checked_at_ms, Some(1_735_000_000_000));
    assert_eq!(decoded_updater.available_version.as_deref(), Some("0.2.0"));
}
