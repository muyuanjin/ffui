use serde_json::{Value, json};

use crate::ffui_core::settings::AppSettings;

#[test]
fn app_settings_round_trips_preset_selection_bar_pinned() {
    // Regression guard: the preset selection toolbar pin toggle must persist
    // across restarts via settings.json.
    let json = json!({
        "presetSelectionBarPinned": true,
    });

    let decoded: AppSettings = serde_json::from_value(json)
        .expect("deserialize AppSettings with presetSelectionBarPinned");
    let round_tripped = serde_json::to_value(&decoded).expect("serialize AppSettings after decode");

    assert_eq!(
        round_tripped
            .get("presetSelectionBarPinned")
            .and_then(Value::as_bool),
        Some(true),
        "presetSelectionBarPinned must survive a decode/encode round-trip",
    );
}
