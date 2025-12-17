use super::*;
use serde_json::Value;

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
