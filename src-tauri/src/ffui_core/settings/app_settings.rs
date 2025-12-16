use anyhow::Result;

use super::io::{executable_sidecar_path, read_json_file, write_json_file};
use super::types::AppSettings;

pub fn load_settings() -> Result<AppSettings> {
    let path = executable_sidecar_path("settings.json")?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let mut settings: AppSettings = read_json_file(&path)?;
    settings.normalize();
    Ok(settings)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = executable_sidecar_path("settings.json")?;
    write_json_file(&path, settings)
}
