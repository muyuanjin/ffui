use super::*;
use serde_json::Value;

#[test]
fn app_settings_round_trips_network_proxy_settings() {
    let settings = AppSettings {
        network_proxy: Some(NetworkProxySettings {
            mode: NetworkProxyMode::Custom,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
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
}
