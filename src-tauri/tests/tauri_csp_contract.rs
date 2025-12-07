use serde_json::Value;

/// Ensure the Tauri CSP configuration allows the `asset` protocol for both
/// images and media so that `convertFileSrc` URLs work correctly after
/// packaging.
#[test]
fn tauri_csp_allows_asset_protocol_for_images_and_media() {
    // Load the Tauri configuration used by this binary.
    let raw = include_str!("../tauri.conf.json");
    let value: Value = serde_json::from_str(raw).expect("tauri.conf.json must be valid JSON");

    let csp = value["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp must be a string");

    assert!(
        csp.contains("img-src")
            && csp.contains("asset: http://asset.localhost")
            && csp.contains("asset: https://asset.localhost"),
        "CSP must allow asset protocol (http/https) for images, got: {csp}"
    );
    assert!(
        csp.contains("media-src")
            && csp.contains("asset: http://asset.localhost")
            && csp.contains("asset: https://asset.localhost"),
        "CSP must allow asset protocol (http/https) for media (video/audio), got: {csp}"
    );
}
