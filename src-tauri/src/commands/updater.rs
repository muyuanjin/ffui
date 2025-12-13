//! App updater capability commands.
//!
//! The frontend needs to know whether the in-app updater is configured for the
//! current build. In local/dev builds, the updater public key is often left as
//! a placeholder, which would otherwise cause update checks to error at runtime.

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const PLACEHOLDER_PUBKEY: &str = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdaterCapabilities {
    pub configured: bool,
}

fn is_pubkey_configured(pubkey: Option<&str>) -> bool {
    let Some(pubkey) = pubkey else {
        return false;
    };
    let trimmed = pubkey.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == PLACEHOLDER_PUBKEY {
        return false;
    }
    // Treat common templating placeholders as "not configured" so local builds
    // do not repeatedly error during startup update checks.
    if trimmed.contains("REPLACE_WITH") || (trimmed.contains("{{") && trimmed.contains("}}")) {
        return false;
    }
    true
}

fn has_endpoints(updater_config: &Value) -> bool {
    let Some(endpoints) = updater_config.get("endpoints") else {
        return false;
    };
    let Some(endpoints) = endpoints.as_array() else {
        return false;
    };
    endpoints.iter().any(|value| {
        value
            .as_str()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    })
}

pub(crate) fn updater_is_configured(config: &tauri::Config) -> bool {
    let Some(updater) = config.plugins.0.get("updater") else {
        return false;
    };
    is_pubkey_configured(updater.get("pubkey").and_then(Value::as_str)) && has_endpoints(updater)
}

/// Return whether the in-app updater plugin is configured for this build.
#[tauri::command]
pub fn get_app_updater_capabilities(app: AppHandle) -> AppUpdaterCapabilities {
    AppUpdaterCapabilities {
        configured: updater_is_configured(app.config()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_pubkey_is_not_configured() {
        assert!(!is_pubkey_configured(Some(PLACEHOLDER_PUBKEY)));
        assert!(!is_pubkey_configured(Some("")));
        assert!(!is_pubkey_configured(Some("   ")));
        assert!(!is_pubkey_configured(Some("{{ env.TAURI_UPDATER_PUBKEY }}")));
    }

    #[test]
    fn non_empty_pubkey_is_configured() {
        assert!(is_pubkey_configured(Some("abc")));
        assert!(is_pubkey_configured(Some("  abc  ")));
    }

    #[test]
    fn endpoints_must_be_present_and_non_empty() {
        let config_missing = serde_json::json!({});
        assert!(!has_endpoints(&config_missing));

        let config_empty = serde_json::json!({ "endpoints": [] });
        assert!(!has_endpoints(&config_empty));

        let config_blank = serde_json::json!({ "endpoints": ["   "] });
        assert!(!has_endpoints(&config_blank));

        let config_valid = serde_json::json!({ "endpoints": ["https://example.com/latest.json"] });
        assert!(has_endpoints(&config_valid));
    }
}
