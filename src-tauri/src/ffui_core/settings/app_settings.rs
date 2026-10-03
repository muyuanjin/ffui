use anyhow::Result;

use super::{AppSettings, SettingsStore};

pub(super) fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.normalize();
    settings
}

pub fn load_settings() -> Result<AppSettings> {
    Ok(SettingsStore::open()?.snapshot().settings)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    SettingsStore::open()?.update(settings)?;
    Ok(())
}
