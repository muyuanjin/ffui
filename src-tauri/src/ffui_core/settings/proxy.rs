use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkProxyMode {
    None,
    #[default]
    System,
    Custom,
}

const fn default_fallback_to_direct_on_error() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct NetworkProxySettings {
    #[serde(default)]
    pub mode: NetworkProxyMode,
    /// Required when mode is Custom.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
    /// When true (default), if proxy is invalid/unreachable the app retries without proxy.
    #[serde(default = "default_fallback_to_direct_on_error")]
    pub fallback_to_direct_on_error: bool,
}
