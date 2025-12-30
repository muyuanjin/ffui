use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::io::{read_json_file, write_json_file};
use super::types::AppSettings;
use crate::ffui_core::data_root::settings_path;

const CURRENT_SETTINGS_FILE_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFileV1 {
    version: u16,
    settings: AppSettings,
}

pub(super) fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.normalize();
    settings
}

fn encode_settings_file_v1(settings: AppSettings) -> SettingsFileV1 {
    SettingsFileV1 {
        version: CURRENT_SETTINGS_FILE_VERSION,
        settings,
    }
}

fn decode_settings_file_json(value: Value) -> Result<(AppSettings, bool)> {
    match value {
        Value::Object(mut obj) => {
            let version_value = obj.remove("version");
            let settings_value = obj.remove("settings");

            let version = match version_value {
                None => None,
                Some(Value::Number(num)) => {
                    let raw = num
                        .as_u64()
                        .context("settings file version must be a positive integer")?;
                    let version = u16::try_from(raw)
                        .context("settings file version must fit in an unsigned 16-bit integer")?;
                    Some(version)
                }
                Some(_) => {
                    return Err(anyhow::anyhow!("settings file version must be an integer"));
                }
            };

            match version {
                None => {
                    if let Some(settings_value) = settings_value {
                        let settings: AppSettings = serde_json::from_value(settings_value)
                            .context("failed to decode legacy settings wrapper")?;
                        return Ok((settings, true));
                    }
                    let settings: AppSettings = serde_json::from_value(Value::Object(obj))
                        .context("failed to decode legacy unversioned settings")?;
                    Ok((settings, true))
                }
                Some(0) => {
                    if let Some(settings_value) = settings_value {
                        let settings: AppSettings = serde_json::from_value(settings_value)
                            .context("failed to decode legacy settings wrapper")?;
                        return Ok((settings, true));
                    }
                    let settings: AppSettings = serde_json::from_value(Value::Object(obj))
                        .context("failed to decode legacy unversioned settings")?;
                    Ok((settings, true))
                }
                Some(1) => {
                    let Some(settings_value) = settings_value else {
                        let settings: AppSettings = serde_json::from_value(Value::Object(obj))
                            .context("failed to decode settings object")?;
                        return Ok((settings, true));
                    };
                    let settings: AppSettings = serde_json::from_value(settings_value)
                        .context("failed to decode settings")?;
                    Ok((settings, false))
                }
                Some(other) => Err(anyhow::anyhow!(
                    "settings file version {other} is newer than supported {CURRENT_SETTINGS_FILE_VERSION}"
                )),
            }
        }
        _ => Err(anyhow::anyhow!("settings file must be a JSON object")),
    }
}

pub fn load_settings() -> Result<AppSettings> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let raw: Value = read_json_file(&path)?;
    let (settings, needs_rewrite) = decode_settings_file_json(raw)
        .with_context(|| format!("failed to decode settings file {}", path.display()))?;
    let normalized = normalize_settings(settings);

    if needs_rewrite {
        write_json_file(&path, &encode_settings_file_v1(normalized.clone()))
            .with_context(|| format!("failed to rewrite settings file {}", path.display()))?;
    }

    Ok(normalized)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = settings_path()?;
    let normalized = normalize_settings(settings.clone());
    write_json_file(&path, &encode_settings_file_v1(normalized))
}
