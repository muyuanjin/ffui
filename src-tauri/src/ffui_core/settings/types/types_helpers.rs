use super::{
    DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS, DEFAULT_UI_FONT_SIZE_PERCENT, DEFAULT_UI_SCALE_PERCENT,
    MAX_PARALLEL_JOBS_LIMIT, UiFontFamily,
};
use crate::ffui_core::domain::OutputPolicy;

pub(super) fn default_ui_scale_percent() -> u16 {
    DEFAULT_UI_SCALE_PERCENT
}

pub(super) fn is_default_ui_scale_percent(value: &u16) -> bool {
    *value == DEFAULT_UI_SCALE_PERCENT
}

pub(super) fn default_ui_font_size_percent() -> u16 {
    DEFAULT_UI_FONT_SIZE_PERCENT
}

pub(super) fn is_default_ui_font_size_percent(value: &u16) -> bool {
    *value == DEFAULT_UI_FONT_SIZE_PERCENT
}

pub(super) fn is_ui_font_family_system(value: &UiFontFamily) -> bool {
    *value == UiFontFamily::System
}

pub(super) fn is_false(value: &bool) -> bool {
    !*value
}

pub(super) fn is_true(value: &bool) -> bool {
    *value
}

pub(super) fn default_exit_auto_wait_enabled() -> bool {
    true
}

pub(super) fn default_exit_auto_wait_timeout_seconds() -> f64 {
    DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS
}

pub(super) fn is_default_exit_auto_wait_timeout_seconds(value: &f64) -> bool {
    *value == DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS
}

pub(super) fn is_default_output_policy(policy: &OutputPolicy) -> bool {
    *policy == OutputPolicy::default()
}

pub(super) fn normalize_parallel_limit(value: Option<u8>) -> Option<u8> {
    match value {
        Some(0) => None,
        Some(v) => Some(v.clamp(1, MAX_PARALLEL_JOBS_LIMIT)),
        None => None,
    }
}

pub(super) fn effective_parallel_limit(value: Option<u8>, default_value: u8) -> u8 {
    match value {
        Some(v) if v >= 1 => v.clamp(1, MAX_PARALLEL_JOBS_LIMIT),
        _ => default_value,
    }
}

pub(super) fn normalize_string_option(value: &mut Option<String>) {
    let Some(current) = value.as_ref() else {
        return;
    };
    let trimmed = current.trim();
    if trimmed.is_empty() {
        *value = None;
        return;
    }
    if trimmed.len() != current.len() {
        *value = Some(trimmed.to_string());
    }
}
