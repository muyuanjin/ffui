use serde_json::Value;

use super::*;

#[test]
fn app_settings_round_trips_network_proxy_settings() {
    let settings = AppSettings {
        network_proxy: Some(NetworkProxySettings {
            mode: NetworkProxyMode::Custom,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
            fallback_to_direct_on_error: true,
        }),
        ..Default::default()
    };

    let json = serde_json::to_value(&settings).expect("serialize AppSettings with network proxy");
    let proxy = json
        .get("networkProxy")
        .and_then(Value::as_object)
        .expect("networkProxy object should be present when set");

    assert_eq!(
        proxy.get("mode").and_then(Value::as_str),
        Some("custom"),
        "networkProxy.mode must serialize as a lowercase string"
    );
    assert_eq!(
        proxy.get("proxyUrl").and_then(Value::as_str),
        Some("http://127.0.0.1:7890"),
        "networkProxy.proxyUrl must serialize in camelCase"
    );

    let decoded: AppSettings = serde_json::from_value(json)
        .expect("round-trip deserialize AppSettings with network proxy");
    let decoded_proxy = decoded
        .network_proxy
        .expect("decoded network proxy present");
    assert_eq!(decoded_proxy.mode, NetworkProxyMode::Custom);
    assert_eq!(
        decoded_proxy.proxy_url.as_deref(),
        Some("http://127.0.0.1:7890")
    );
    assert!(
        decoded_proxy.fallback_to_direct_on_error,
        "fallback_to_direct_on_error defaults to true and must round-trip"
    );
}

#[test]
fn app_settings_keeps_proxy_url_even_when_mode_is_not_custom() {
    for (mode, expected_mode) in [
        (NetworkProxyMode::System, "system"),
        (NetworkProxyMode::None, "none"),
    ] {
        let settings = AppSettings {
            network_proxy: Some(NetworkProxySettings {
                mode,
                proxy_url: Some("http://127.0.0.1:7890".to_string()),
                fallback_to_direct_on_error: true,
            }),
            ..Default::default()
        };

        let json =
            serde_json::to_value(&settings).expect("serialize AppSettings with network proxy");
        let proxy = json
            .get("networkProxy")
            .and_then(Value::as_object)
            .expect("networkProxy object should be present when set");

        assert_eq!(
            proxy.get("mode").and_then(Value::as_str),
            Some(expected_mode)
        );
        assert_eq!(
            proxy.get("proxyUrl").and_then(Value::as_str),
            Some("http://127.0.0.1:7890")
        );

        let decoded: AppSettings = serde_json::from_value(json)
            .expect("round-trip deserialize AppSettings with network proxy");
        let decoded_proxy = decoded
            .network_proxy
            .expect("decoded network proxy present");
        assert_eq!(decoded_proxy.mode, mode);
        assert_eq!(
            decoded_proxy.proxy_url.as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }
}
