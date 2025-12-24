//! Settings and batch compress configuration commands.
//!
//! Provides commands for managing application settings and batch compress:
//! - Getting and saving application settings
//! - Managing batch compress default configuration
//! - Running auto-compression (batch compress and transcode)

use tauri::State;

use crate::ffui_core::{AppSettings, AutoCompressResult, BatchCompressConfig, TranscodingEngine};

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

/// Get the default batch compress configuration.
#[tauri::command]
pub fn get_batch_compress_defaults(engine: State<'_, TranscodingEngine>) -> BatchCompressConfig {
    engine.batch_compress_defaults()
}

/// Save the default batch compress configuration.
#[tauri::command]
pub fn save_batch_compress_defaults(
    engine: State<'_, TranscodingEngine>,
    config: BatchCompressConfig,
) -> Result<BatchCompressConfig, String> {
    engine
        .update_batch_compress_defaults(config)
        .map_err(|e| e.to_string())
}

/// Run auto-compression: scan a directory and enqueue matching files.
#[tauri::command]
pub fn run_auto_compress(
    engine: State<'_, TranscodingEngine>,
    root_path: String,
    config: BatchCompressConfig,
) -> Result<AutoCompressResult, String> {
    engine
        .run_auto_compress(root_path, config)
        .map_err(|e| e.to_string())
}
