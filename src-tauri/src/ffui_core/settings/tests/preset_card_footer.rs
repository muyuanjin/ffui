use serde_json::{Value, json};

use crate::ffui_core::settings::types::preset_card_footer::{
    PresetCardFooterItemKey, PresetCardFooterLayout,
};
use crate::ffui_core::settings::types::{AppSettings, PresetCardFooterSettings};

#[test]
fn app_settings_round_trips_preset_card_footer_settings() {
    let settings = AppSettings {
        preset_card_footer: Some(PresetCardFooterSettings {
            layout: PresetCardFooterLayout::OneRow,
            show_data_amount: false,
            show_throughput: false,
            ..PresetCardFooterSettings::default()
        }),
        ..AppSettings::default()
    };

    let value =
        serde_json::to_value(&settings).expect("serialize AppSettings with preset card footer");
    let footer = value
        .get("presetCardFooter")
        .and_then(Value::as_object)
        .expect("presetCardFooter must be present as object");
    assert_eq!(
        footer.get("layout").and_then(Value::as_str),
        Some("oneRow"),
        "layout must serialize as camelCase string",
    );
    assert_eq!(
        footer.get("showDataAmount").and_then(Value::as_bool),
        Some(false),
        "showDataAmount must serialize when false",
    );
    assert_eq!(
        footer.get("showThroughput").and_then(Value::as_bool),
        Some(false),
        "showThroughput must serialize when false",
    );
    assert!(
        footer.get("showAvgSize").is_none(),
        "showAvgSize should be omitted when true (default)",
    );

    let decoded: AppSettings =
        serde_json::from_value(value).expect("deserialize AppSettings with preset card footer");
    let footer = decoded.preset_card_footer.expect("footer settings");
    assert_eq!(footer.layout, PresetCardFooterLayout::OneRow);
    assert!(!footer.show_data_amount);
    assert!(!footer.show_throughput);
}

#[test]
fn app_settings_normalizes_empty_preset_card_footer_to_none() {
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
        "presetCardFooter": {}
    }))
    .expect("deserialize AppSettings with presetCardFooter");

    decoded.normalize();
    assert!(
        decoded.preset_card_footer.is_none(),
        "default/empty presetCardFooter must normalize to None",
    );

    let reserialized = serde_json::to_value(&decoded).expect("serialize normalized AppSettings");
    assert!(
        reserialized.get("presetCardFooter").is_none(),
        "presetCardFooter should be absent after normalization",
    );
}

#[test]
fn app_settings_normalizes_unknown_preset_card_footer_layout() {
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
        "presetCardFooter": { "layout": "not-a-real-layout" }
    }))
    .expect("deserialize AppSettings with unknown presetCardFooter layout");

    decoded.normalize();
    assert!(
        decoded.preset_card_footer.is_none(),
        "unknown layout should normalize back to default and then be dropped",
    );

    let reserialized = serde_json::to_value(&decoded).expect("serialize normalized AppSettings");
    assert!(
        reserialized.get("presetCardFooter").is_none(),
        "presetCardFooter should be absent after normalization",
    );
}

#[test]
fn app_settings_normalizes_preset_card_footer_order() {
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
        "presetCardFooter": {
            "order": ["vmaf", "vmaf", "fps", "not-a-real-item"]
        }
    }))
    .expect("deserialize AppSettings with presetCardFooter order");

    decoded.normalize();
    let footer = decoded
        .preset_card_footer
        .as_ref()
        .expect("footer settings should remain");

    let order = footer
        .order
        .as_ref()
        .expect("non-default order should persist");
    assert_eq!(
        &order[0..2],
        &[PresetCardFooterItemKey::Vmaf, PresetCardFooterItemKey::Fps]
    );
}
