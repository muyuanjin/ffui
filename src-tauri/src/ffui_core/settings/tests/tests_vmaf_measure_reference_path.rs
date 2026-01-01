use serde_json::{Value, json};

use crate::ffui_core::settings::AppSettings;

#[test]
fn app_settings_round_trips_vmaf_measure_reference_path() {
    // Regression guard: the VMAF measurement dialog should remember the last
    // used reference video across restarts via settings.json.
    let json = json!({
        "vmafMeasureReferencePath": "D:/vmaf/samples/bbb1080p30s.mp4",
    });

    let decoded: AppSettings = serde_json::from_value(json)
        .expect("deserialize AppSettings with vmafMeasureReferencePath");
    let round_tripped = serde_json::to_value(&decoded).expect("serialize AppSettings after decode");

    assert_eq!(
        round_tripped
            .get("vmafMeasureReferencePath")
            .and_then(Value::as_str),
        Some("D:/vmaf/samples/bbb1080p30s.mp4"),
        "vmafMeasureReferencePath must survive a decode/encode round-trip",
    );
}
#[test]
fn app_settings_normalize_trims_vmaf_measure_reference_path() {
    let mut settings = AppSettings {
        vmaf_measure_reference_path: Some("  D:/vmaf/samples/bbb1080p30s.mp4  ".to_string()),
        ..AppSettings::default()
    };
    settings.normalize();
    assert_eq!(
        settings.vmaf_measure_reference_path.as_deref(),
        Some("D:/vmaf/samples/bbb1080p30s.mp4")
    );

    let mut empty = AppSettings {
        vmaf_measure_reference_path: Some("   ".to_string()),
        ..AppSettings::default()
    };
    empty.normalize();
    assert!(
        empty.vmaf_measure_reference_path.is_none(),
        "whitespace-only vmaf_measure_reference_path must normalize to None"
    );
}
