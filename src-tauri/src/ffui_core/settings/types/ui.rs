use serde::{Deserialize, Serialize};

pub const DEFAULT_UI_SCALE_PERCENT: u16 = 100;
pub const DEFAULT_UI_FONT_SIZE_PERCENT: u16 = 100;

/// Global UI font family preference.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum UiFontFamily {
    /// Use platform default UI font stack.
    #[default]
    System,
    /// Prefer sans-serif stack (still falls back to system defaults).
    Sans,
    /// Prefer monospace stack (useful for logs/commands).
    Mono,
}
