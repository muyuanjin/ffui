use serde::{Deserialize, Serialize};

use super::types_helpers;

/// Preset card footer stats layout.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PresetCardFooterLayout {
    #[default]
    TwoRows,
    OneRow,
    #[serde(other)]
    Unknown,
}

const fn default_true() -> bool {
    true
}

const fn is_default_layout(value: &PresetCardFooterLayout) -> bool {
    matches!(value, PresetCardFooterLayout::TwoRows)
}

/// Footer item key, used for ordering the displayed stats.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PresetCardFooterItemKey {
    AvgSize,
    Fps,
    Vmaf,
    UsedCount,
    DataAmount,
    Throughput,
    #[serde(other)]
    Unknown,
}

const DEFAULT_ORDER: [PresetCardFooterItemKey; 6] = [
    PresetCardFooterItemKey::AvgSize,
    PresetCardFooterItemKey::Fps,
    PresetCardFooterItemKey::Vmaf,
    PresetCardFooterItemKey::UsedCount,
    PresetCardFooterItemKey::DataAmount,
    PresetCardFooterItemKey::Throughput,
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct PresetCardFooterSettings {
    #[serde(default, skip_serializing_if = "is_default_layout")]
    pub layout: PresetCardFooterLayout,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<Vec<PresetCardFooterItemKey>>,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_avg_size: bool,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_fps: bool,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_vmaf: bool,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_used_count: bool,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_data_amount: bool,
    #[serde(
        default = "default_true",
        skip_serializing_if = "types_helpers::is_true"
    )]
    pub show_throughput: bool,
}

impl Default for PresetCardFooterSettings {
    fn default() -> Self {
        Self {
            layout: PresetCardFooterLayout::TwoRows,
            order: None,
            show_avg_size: true,
            show_fps: true,
            show_vmaf: true,
            show_used_count: true,
            show_data_amount: true,
            show_throughput: true,
        }
    }
}

impl PresetCardFooterSettings {
    pub fn normalize(&mut self) {
        if self.layout == PresetCardFooterLayout::Unknown {
            self.layout = PresetCardFooterLayout::TwoRows;
        }

        if let Some(raw) = self.order.as_ref() {
            let mut seen: std::collections::HashSet<PresetCardFooterItemKey> =
                std::collections::HashSet::new();
            let mut out: Vec<PresetCardFooterItemKey> = Vec::new();

            for k in raw {
                if *k == PresetCardFooterItemKey::Unknown {
                    continue;
                }
                if !DEFAULT_ORDER.contains(k) {
                    continue;
                }
                if seen.insert(*k) {
                    out.push(*k);
                }
            }

            for k in DEFAULT_ORDER {
                if seen.insert(k) {
                    out.push(k);
                }
            }

            if out.as_slice() == DEFAULT_ORDER.as_slice() {
                self.order = None;
            } else {
                self.order = Some(out);
            }
        }
    }

    pub fn is_effectively_default(&self) -> bool {
        self.layout == PresetCardFooterLayout::TwoRows
            && self.order.is_none()
            && self.show_avg_size
            && self.show_fps
            && self.show_vmaf
            && self.show_used_count
            && self.show_data_amount
            && self.show_throughput
    }
}
