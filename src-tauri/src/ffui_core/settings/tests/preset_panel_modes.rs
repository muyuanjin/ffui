use serde_json::{Value, json};

use crate::ffui_core::settings::types::{AppSettings, PresetSortMode, PresetViewMode};

#[test]
fn app_settings_round_trips_preset_panel_modes() {
    let settings = AppSettings {
        preset_sort_mode: Some(PresetSortMode::Name),
        preset_view_mode: Some(PresetViewMode::Compact),
        ..AppSettings::default()
    };

    let value =
        serde_json::to_value(&settings).expect("serialize AppSettings with preset panel modes");
    assert_eq!(
        value.get("presetSortMode").and_then(Value::as_str),
        Some("name"),
        "presetSortMode must serialize as camelCase string",
    );
    assert_eq!(
        value.get("presetViewMode").and_then(Value::as_str),
        Some("compact"),
        "presetViewMode must serialize as camelCase string",
    );

    let decoded: AppSettings =
        serde_json::from_value(value).expect("deserialize AppSettings with preset panel modes");
    assert_eq!(decoded.preset_sort_mode, Some(PresetSortMode::Name));
    assert_eq!(decoded.preset_view_mode, Some(PresetViewMode::Compact));
}

#[test]
fn app_settings_normalizes_unknown_preset_panel_modes() {
    let mut decoded: AppSettings = serde_json::from_value(json!({
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
        "presetSortMode": "thisIsNotARealMode",
        "presetViewMode": "alsoInvalid"
    }))
    .expect("deserialize AppSettings with unknown preset panel modes");

    decoded.normalize();
    assert!(
        decoded.preset_sort_mode.is_none(),
        "unknown presetSortMode must normalize to None"
    );
    assert!(
        decoded.preset_view_mode.is_none(),
        "unknown presetViewMode must normalize to None"
    );

    let reserialized = serde_json::to_value(&decoded).expect("serialize normalized AppSettings");
    assert!(
        reserialized.get("presetSortMode").is_none(),
        "presetSortMode should be absent after normalization"
    );
    assert!(
        reserialized.get("presetViewMode").is_none(),
        "presetViewMode should be absent after normalization"
    );
}
