use std::fs;

use serde_json::{Value, json};
use tempfile::tempdir;

use super::types::{DEFAULT_UI_SCALE_PERCENT, UiFontFamily};
use super::*;

mod network_proxy;
mod preset_card_footer;
mod preset_panel_modes;
mod presets_loading;
mod tests_preset_selection_bar_pinned;
mod tests_selection_bar_pinned;
mod tests_vmaf_measure_reference_path;
mod tools_custom_path_sanitization;
mod updater_metadata;

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
        "default max_parallel_jobs must be None so settings.json stays minimal (engine defaults apply)"
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
fn app_settings_normalize_entry_point_trims_locale_and_recovers_invalid_numbers() {
    let settings = AppSettings {
        locale: Some("  en  ".to_string()),
        exit_auto_wait_timeout_seconds: f64::NAN,
        ..AppSettings::default()
    };

    let normalized = super::app_settings::normalize_settings(settings);
    assert_eq!(normalized.locale.as_deref(), Some("en"));
    assert_eq!(
        normalized.exit_auto_wait_timeout_seconds,
        DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS
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
    assert!(
        value.get("parallelismMode").is_none(),
        "parallelismMode should be absent when unset"
    );
    assert!(
        value.get("maxParallelCpuJobs").is_none(),
        "maxParallelCpuJobs should be absent when unset"
    );
    assert!(
        value.get("maxParallelHwJobs").is_none(),
        "maxParallelHwJobs should be absent when unset"
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
    assert!(
        value.get("presetSelectionBarPinned").is_none(),
        "presetSelectionBarPinned should be absent when false"
    );
    assert!(
        value.get("vmafMeasureReferencePath").is_none(),
        "vmafMeasureReferencePath should be absent when unset"
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
    assert!(
        value.get("locale").is_none(),
        "locale should be absent when unset"
    );
}

#[test]
fn app_settings_round_trips_locale_when_present() {
    let settings = AppSettings {
        locale: Some("en".to_string()),
        ..AppSettings::default()
    };
    let value = serde_json::to_value(&settings).expect("serialize AppSettings with locale");
    assert_eq!(
        value.get("locale").and_then(Value::as_str),
        Some("en"),
        "locale should serialize as a string when set"
    );

    let decoded: AppSettings =
        serde_json::from_value(value).expect("deserialize AppSettings with locale");
    assert_eq!(
        decoded.locale.as_deref(),
        Some("en"),
        "locale should round-trip through JSON"
    );
}

#[test]
fn load_settings_migrates_legacy_unversioned_file_to_versioned_envelope() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    let legacy = json!({
        "locale": "  en  ",
        "queuePersistenceMode": "crashRecovery"
    });
    fs::write(&path, legacy.to_string()).expect("write legacy settings");

    let loaded = load_settings().expect("load_settings migrates legacy settings");
    assert_eq!(
        loaded.locale.as_deref(),
        Some("en"),
        "load_settings must normalize legacy locale on read"
    );
    assert_eq!(
        loaded.queue_persistence_mode,
        QueuePersistenceMode::CrashRecoveryLite,
        "legacy crashRecovery alias must map to CrashRecoveryLite"
    );

    let rewritten: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("read rewritten settings"))
            .expect("parse rewritten settings JSON");
    assert_eq!(
        rewritten.get("version").and_then(Value::as_u64),
        Some(1),
        "settings file must be rewritten with a version envelope"
    );
    assert!(
        rewritten.get("settings").is_some(),
        "settings file must be rewritten with a top-level settings object"
    );
    assert_eq!(
        rewritten
            .get("settings")
            .and_then(Value::as_object)
            .and_then(|settings| settings.get("locale"))
            .and_then(Value::as_str),
        Some("en"),
        "rewritten settings must persist normalized locale"
    );
}

#[test]
fn load_settings_migrates_legacy_wrapper_without_version_to_versioned_envelope() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    let legacy = json!({
        "settings": {
            "locale": "zh-CN"
        }
    });
    fs::write(&path, legacy.to_string()).expect("write legacy wrapped settings");

    let loaded = load_settings().expect("load_settings migrates legacy wrapper");
    assert_eq!(loaded.locale.as_deref(), Some("zh-CN"));

    let rewritten: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("read rewritten settings"))
            .expect("parse rewritten settings JSON");
    assert_eq!(
        rewritten.get("version").and_then(Value::as_u64),
        Some(1),
        "legacy wrapper must be rewritten with version 1 envelope"
    );
    assert!(
        rewritten.get("settings").is_some(),
        "legacy wrapper must be rewritten with a top-level settings object"
    );
}

#[test]
fn load_settings_keeps_loaded_settings_when_rewrite_fails() {
    use std::fs;

    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    // Legacy unversioned settings that require a rewrite/migration on read.
    let legacy = json!({
        "locale": "  en  ",
        "onboardingCompleted": true
    });
    fs::write(&path, legacy.to_string()).expect("write legacy settings");

    // Force the atomic temp file creation to fail by pre-creating a directory at
    // the tmp path. This simulates unusual filesystem conditions without
    // relying on platform-specific permission bits.
    let tmp_path = path.with_extension("tmp");
    fs::create_dir_all(&tmp_path).expect("create tmp path as directory");

    let loaded = load_settings().expect("load_settings should not fail if rewrite fails");
    assert_eq!(
        loaded.locale.as_deref(),
        Some("en"),
        "settings must still load and normalize even if rewrite fails"
    );
    assert!(
        loaded.onboarding_completed,
        "settings must preserve onboardingCompleted even if rewrite fails"
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
        "batchCompressDefaults": {
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
    assert!(
        decoded.titlebar_progress_enabled,
        "legacy settings without titlebarProgressEnabled must decode with titlebar_progress_enabled = true"
    );
    // Legacy JSON without tools.downloaded should transparently default to
    // an empty metadata map.
    assert!(
        decoded.tools.downloaded.is_none(),
        "legacy settings without tools.downloaded must decode with downloaded = None"
    );
}

#[test]
fn app_settings_serializes_titlebar_progress_enabled_when_disabled() {
    let settings = AppSettings {
        titlebar_progress_enabled: false,
        ..AppSettings::default()
    };
    let value = serde_json::to_value(&settings)
        .expect("serialize AppSettings with titlebar progress disabled");
    assert_eq!(
        value
            .get("titlebarProgressEnabled")
            .and_then(Value::as_bool),
        Some(false),
        "titlebarProgressEnabled should serialize when non-default"
    );

    let decoded: AppSettings = serde_json::from_value(value)
        .expect("deserialize AppSettings with titlebar progress disabled");
    assert!(
        !decoded.titlebar_progress_enabled,
        "titlebar_progress_enabled should round-trip when disabled"
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
            source_url: Some("https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1/ffmpeg-win32-x64".to_string()),
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
fn app_settings_normalizes_invalid_parallel_limits() {
    let mut settings = AppSettings {
        max_parallel_jobs: Some(0),
        max_parallel_cpu_jobs: Some(0),
        max_parallel_hw_jobs: Some(0),
        ..Default::default()
    };
    settings.normalize();

    assert!(
        settings.max_parallel_jobs.is_none(),
        "max_parallel_jobs=0 should normalize to None (invalid/legacy value)"
    );
    assert!(
        settings.max_parallel_cpu_jobs.is_none(),
        "max_parallel_cpu_jobs=0 should normalize to None (invalid/legacy value)"
    );
    assert!(
        settings.max_parallel_hw_jobs.is_none(),
        "max_parallel_hw_jobs=0 should normalize to None (invalid/legacy value)"
    );

    assert_eq!(
        settings.effective_max_parallel_jobs(),
        crate::ffui_core::settings::types::DEFAULT_MAX_PARALLEL_JOBS
    );
    assert_eq!(
        settings.effective_max_parallel_cpu_jobs(),
        crate::ffui_core::settings::types::DEFAULT_MAX_PARALLEL_CPU_JOBS
    );
    assert_eq!(
        settings.effective_max_parallel_hw_jobs(),
        crate::ffui_core::settings::types::DEFAULT_MAX_PARALLEL_HW_JOBS
    );

    let mut settings = AppSettings {
        max_parallel_jobs: Some(250),
        max_parallel_cpu_jobs: Some(250),
        max_parallel_hw_jobs: Some(250),
        ..Default::default()
    };
    settings.normalize();

    assert_eq!(
        settings.max_parallel_jobs,
        Some(crate::ffui_core::settings::types::MAX_PARALLEL_JOBS_LIMIT)
    );
    assert_eq!(
        settings.max_parallel_cpu_jobs,
        Some(crate::ffui_core::settings::types::MAX_PARALLEL_JOBS_LIMIT)
    );
    assert_eq!(
        settings.max_parallel_hw_jobs,
        Some(crate::ffui_core::settings::types::MAX_PARALLEL_JOBS_LIMIT)
    );
}
