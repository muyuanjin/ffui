use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::io::write_json_file;
use super::types::AppSettings;
use crate::ffui_core::data_root::settings_path;

const CURRENT_SETTINGS_FILE_VERSION: u16 = 1;
const LAST_GOOD_SETTINGS_FILENAME: &str = "ffui.settings.last-good.json";

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

fn last_good_settings_path(settings_path: &Path) -> Option<PathBuf> {
    Some(settings_path.parent()?.join(LAST_GOOD_SETTINGS_FILENAME))
}

fn recover_from_last_good(settings_path: &Path) -> Option<AppSettings> {
    let last_good_path = last_good_settings_path(settings_path)?;
    let last_good_bytes = fs::read(&last_good_path).ok()?;
    let last_good_value = serde_json::from_slice::<Value>(&last_good_bytes).ok()?;
    let (settings, _) = decode_settings_file_json(last_good_value).ok()?;
    let normalized = normalize_settings(settings);
    if let Err(err) = write_json_file(settings_path, &encode_settings_file_v1(normalized.clone())) {
        crate::debug_eprintln!(
            "failed to self-heal settings file {} from last-good {}: {err:#}",
            settings_path.display(),
            last_good_path.display()
        );
    }
    Some(normalized)
}

fn backup_unreadable_settings_file(path: &Path, raw: &[u8], reason: &str) -> Option<PathBuf> {
    let parent = path.parent()?;
    let filename = path.file_name()?.to_string_lossy();
    let ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id();

    for attempt in 0..64u32 {
        let dest = parent.join(format!("{filename}.corrupt-{ts_ms}-{pid}-{attempt}.bak"));
        if dest.exists() {
            continue;
        }

        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
        {
            Ok(file) => file,
            Err(_) => continue,
        };
        if file.write_all(raw).is_ok() && file.sync_all().is_ok() {
            crate::debug_eprintln!(
                "backed up unreadable settings file {} -> {} ({reason})",
                path.display(),
                dest.display()
            );
            return Some(dest);
        }
    }

    None
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
                Some(other) => {
                    // Best-effort downgrade support: attempt to decode the settings payload even
                    // when the version marker is newer, so users don't lose their settings when
                    // temporarily running an older build.
                    let source = settings_value.unwrap_or(Value::Object(obj));
                    let settings: AppSettings = serde_json::from_value(source).with_context(|| {
                        format!(
                            "failed to decode settings file version {other} (newer than supported {CURRENT_SETTINGS_FILE_VERSION})"
                        )
                    })?;
                    Ok((settings, false))
                }
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

    let raw_bytes = fs::read(&path)
        .with_context(|| format!("failed to read settings file {}", path.display()))?;
    let raw: Value = match serde_json::from_slice(&raw_bytes) {
        Ok(value) => value,
        Err(err) => {
            let _ = backup_unreadable_settings_file(&path, &raw_bytes, "invalid json");
            crate::debug_eprintln!("failed to parse settings JSON {}: {err:#}", path.display());
            if let Some(recovered) = recover_from_last_good(&path) {
                return Ok(recovered);
            }
            return Err(anyhow::anyhow!(
                "settings file {} is not valid JSON",
                path.display()
            ));
        }
    };
    let (settings, needs_rewrite) = match decode_settings_file_json(raw) {
        Ok(decoded) => decoded,
        Err(err) => {
            let _ = backup_unreadable_settings_file(&path, &raw_bytes, "decode failure");
            crate::debug_eprintln!("failed to decode settings file {}: {err:#}", path.display());
            if let Some(recovered) = recover_from_last_good(&path) {
                return Ok(recovered);
            }
            return Err(err)
                .with_context(|| format!("failed to decode settings file {}", path.display()));
        }
    };
    let normalized = normalize_settings(settings);

    if needs_rewrite {
        // Best-effort migration: the app must not lose the user's settings just
        // because rewriting the legacy file fails (e.g. due to transient file
        // locks, permissions, or unusual filesystem conditions).
        if let Err(err) = write_json_file(&path, &encode_settings_file_v1(normalized.clone())) {
            crate::debug_eprintln!(
                "failed to rewrite settings file {}: {err:#}",
                path.display()
            );
        }
    }

    Ok(normalized)
}

pub fn save_settings(settings: &AppSettings) -> Result<()> {
    let path = settings_path()?;
    let normalized = normalize_settings(settings.clone());
    let encoded = encode_settings_file_v1(normalized);
    write_json_file(&path, &encoded)?;
    if let Some(last_good_path) = last_good_settings_path(&path)
        && let Err(err) = write_json_file(&last_good_path, &encoded)
    {
        crate::debug_eprintln!(
            "failed to persist last-good settings file {}: {err:#}",
            last_good_path.display()
        );
    }
    Ok(())
}
