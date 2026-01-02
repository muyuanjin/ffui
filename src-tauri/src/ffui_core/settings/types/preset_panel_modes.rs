use serde::{Deserialize, Serialize};

/// Preset sort mode for the presets panel and dropdown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PresetSortMode {
    #[default]
    Manual,
    Usage,
    InputSize,
    CreatedTime,
    Ratio,
    Vmaf,
    Speed,
    Name,
    #[serde(other)]
    Unknown,
}

/// Preset sort direction for the presets panel and dropdown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PresetSortDirection {
    #[default]
    Asc,
    Desc,
    #[serde(other)]
    Unknown,
}

/// Preset view mode for the presets panel.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PresetViewMode {
    #[default]
    Grid,
    Compact,
    #[serde(other)]
    Unknown,
}
