//! Settings and smart scan configuration commands.
//!
//! Provides commands for managing application settings and smart scan:
//! - Getting and saving application settings
//! - Managing smart scan default configuration
//! - Running auto-compression (smart scan and transcode)

use tauri::State;

use crate::ffui_core::{
    AppSettings,
    AutoCompressResult,
    SmartScanConfig,
    TranscodingEngine,
};

/// Get the current application settings.
#[tauri::command]
pub fn get_app_settings(engine: State<'_, TranscodingEngine>) -> AppSettings {
    engine.settings()
}

/// Save application settings.
#[tauri::command]
pub fn save_app_settings(
    engine: State<'_, TranscodingEngine>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    engine.save_settings(settings).map_err(|e| e.to_string())
}

/// Get the default smart scan configuration.
#[tauri::command]
pub fn get_smart_scan_defaults(engine: State<'_, TranscodingEngine>) -> SmartScanConfig {
    engine.smart_scan_defaults()
}

/// Save the default smart scan configuration.
#[tauri::command]
pub fn save_smart_scan_defaults(
    engine: State<'_, TranscodingEngine>,
    config: SmartScanConfig,
) -> Result<SmartScanConfig, String> {
    engine
        .update_smart_scan_defaults(config)
        .map_err(|e| e.to_string())
}

/// Run auto-compression: scan a directory and enqueue matching files.
#[tauri::command]
pub fn run_auto_compress(
    engine: State<'_, TranscodingEngine>,
    root_path: String,
    config: SmartScanConfig,
) -> Result<AutoCompressResult, String> {
    engine
        .run_auto_compress(root_path, config)
        .map_err(|e| e.to_string())
}
