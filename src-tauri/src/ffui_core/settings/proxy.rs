use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkProxyMode {
    None,
    #[default]
    System,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct NetworkProxySettings {
    #[serde(default)]
    pub mode: NetworkProxyMode,
    /// Required when mode is Custom.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_url: Option<String>,
}

