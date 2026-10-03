use std::path::Path;

use tauri::{AppHandle, State};

use crate::commands::tools::reveal_path_in_folder;
use crate::ffui_core::SettingsSnapshot;
use crate::ffui_core::{
    ConfigBundle, ConfigBundleExportResult, ConfigBundleImportResult, DataRootInfo, DataRootMode,
    TranscodingEngine, acknowledge_fallback_notice, clear_app_data_root, data_root_dir,
    data_root_info, export_config_bundle as export_config_bundle_impl, load_presets,
    read_config_bundle, set_data_root_mode as set_data_root_mode_impl,
};

#[tauri::command]
pub fn get_data_root_info() -> Result<DataRootInfo, String> {
    data_root_info().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_data_root_mode(mode: DataRootMode) -> Result<DataRootInfo, String> {
    set_data_root_mode_impl(mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn acknowledge_data_root_fallback_notice() -> Result<bool, String> {
    acknowledge_fallback_notice()
        .map(|()| true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_data_root_dir() -> Result<(), String> {
    let root = data_root_dir().map_err(|e| e.to_string())?;
    if let Err(err) = std::fs::create_dir_all(&root) {
        return Err(format!(
            "failed to create data root {}: {err}",
            root.display()
        ));
    }
    reveal_path_in_folder(root.to_string_lossy().into_owned())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn export_config_bundle(
    app: AppHandle,
    engine: State<'_, TranscodingEngine>,
    target_path: String,
) -> Result<ConfigBundleExportResult, String> {
    let trimmed = target_path.trim();
    if trimmed.is_empty() {
        return Err("export path is empty".to_string());
    }
    let path = Path::new(trimmed);
    let settings = engine
        .settings_document()
        .map_err(|error| format!("{error:#}"))?;
    let presets = (*engine.presets()).clone();
    let app_version = app.package_info().version.to_string();
    export_config_bundle_impl(path, settings, presets, app_version).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn import_config_bundle(
    engine: State<'_, TranscodingEngine>,
    source_path: String,
) -> Result<ConfigBundleImportResult, String> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err("import path is empty".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_file() {
        return Err("import path does not point to a file".to_string());
    }

    let bundle = read_config_bundle(path).map_err(|e| e.to_string())?;
    import_bundle(&engine, bundle)
}

fn import_bundle(
    engine: &TranscodingEngine,
    bundle: ConfigBundle,
) -> Result<ConfigBundleImportResult, String> {
    let ConfigBundle {
        schema_version,
        app_version,
        settings_document,
        presets,
        ..
    } = bundle;
    let previous_presets = (*engine.presets()).clone();

    let preset_count = presets.len();
    if let Err(err) = engine.replace_presets(presets) {
        return Err(err.to_string());
    }

    match engine.import_settings_document(settings_document) {
        Ok(saved_settings) => Ok(ConfigBundleImportResult {
            settings: saved_settings,
            preset_count,
            schema_version,
            app_version,
        }),
        Err(err) => match engine.replace_presets(previous_presets) {
            Ok(_) => Err(format!("{err:#}")),
            Err(rollback) => Err(format!(
                "Settings import failed: {err:#}; preset rollback failed: {rollback:#}"
            )),
        },
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn clear_all_app_data(
    engine: State<'_, TranscodingEngine>,
) -> Result<SettingsSnapshot, String> {
    clear_app_data_root().map_err(|e| e.to_string())?;
    let saved_settings = engine.reset_settings().map_err(|e| e.to_string())?;
    let presets = load_presets().map_err(|e| e.to_string())?;
    drop(engine.replace_presets(presets).map_err(|e| e.to_string())?);
    Ok(saved_settings)
}

#[cfg(test)]
mod tests;
