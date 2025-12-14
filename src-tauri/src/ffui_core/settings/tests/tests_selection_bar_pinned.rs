use crate::ffui_core::settings::AppSettings;
use serde_json::{Value, json};

#[test]
fn app_settings_round_trips_selection_bar_pinned() {
    // Regression guard: the queue selection toolbar pin toggle must persist
    // across restarts via settings.json.
    let json = json!({
        "selectionBarPinned": true,
    });

    let decoded: AppSettings =
        serde_json::from_value(json).expect("deserialize AppSettings with selectionBarPinned");
    let round_tripped = serde_json::to_value(&decoded).expect("serialize AppSettings after decode");

    assert_eq!(
        round_tripped
            .get("selectionBarPinned")
            .and_then(Value::as_bool),
        Some(true),
        "selectionBarPinned must survive a decode/encode round-trip",
    );
}
