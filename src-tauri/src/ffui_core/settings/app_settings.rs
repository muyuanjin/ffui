use anyhow::Result;

use super::io::{
    read_json_file,
    write_json_file,
};
use super::types::AppSettings;
use crate::ffui_core::data_root::settings_path;

pub fn load_settings() -> Result<AppSettings> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let mut settings: AppSettings = read_json_file(&path)?;
    settings.normalize();
    Ok(settings)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = settings_path()?;
    write_json_file(&path, settings)
}
