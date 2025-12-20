use std::fs;
use std::path::Path;

use serde_json::Value;

#[test]
fn capabilities_allow_dialog_save() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let capabilities_path = crate_root.join("capabilities").join("default.json");
    let capabilities_raw =
        fs::read_to_string(&capabilities_path).expect("failed to read capabilities/default.json");
    let capabilities: Value = serde_json::from_str(&capabilities_raw)
        .expect("capabilities/default.json must be valid JSON");

    let permissions = capabilities
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("capabilities/default.json permissions must be an array");

    assert!(
        permissions
            .iter()
            .any(|entry| entry.as_str() == Some("dialog:allow-save")),
        "capabilities/default.json must include dialog:allow-save so exporting config can open a save dialog"
    );
}
