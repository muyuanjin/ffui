use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::ffui_core::FFmpegPreset;
use crate::ffui_core::settings::io::{read_json_file, write_json_file};
use crate::ffui_core::settings::{SettingsSnapshot, SettingsStore};
use crate::ffui_core::tools::{ExternalToolKind, verify_tool_binary};
use serde_json::Value;

pub const CONFIG_BUNDLE_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundle {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at_ms: u64,
    pub settings_document: Value,
    pub presets: Vec<FFmpegPreset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundleExportResult {
    pub path: String,
    pub app_version: String,
    pub exported_at_ms: u64,
    pub preset_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundleImportResult {
    pub settings: SettingsSnapshot,
    pub preset_count: usize,
    pub schema_version: u32,
    pub app_version: String,
}

fn now_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

fn validate_tool_path(path: Option<&str>, kind: ExternalToolKind) -> Result<()> {
    let trimmed = path.unwrap_or("").trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if verify_tool_binary(trimmed, kind, "config-bundle-import") {
        return Ok(());
    }
    bail!("invalid {kind:?} path in imported settings");
}

fn validate_config_bundle(bundle: &ConfigBundle) -> Result<()> {
    if !matches!(bundle.schema_version, 1 | 2) {
        bail!(
            "unsupported config bundle schema {} (expected {})",
            bundle.schema_version,
            CONFIG_BUNDLE_SCHEMA_VERSION
        );
    }
    let snapshot = SettingsStore::inspect_document(&bundle.settings_document)?;
    if snapshot
        .unavailable_settings
        .iter()
        .any(|entry| entry.path.is_empty())
    {
        bail!("Unsupported settings document version in config bundle");
    }
    validate_tool_path(
        snapshot.settings.tools.ffmpeg_path.as_deref(),
        ExternalToolKind::Ffmpeg,
    )?;
    validate_tool_path(
        snapshot.settings.tools.ffprobe_path.as_deref(),
        ExternalToolKind::Ffprobe,
    )?;
    validate_tool_path(
        snapshot.settings.tools.avifenc_path.as_deref(),
        ExternalToolKind::Avifenc,
    )?;
    Ok(())
}

pub fn export_config_bundle(
    path: &Path,
    settings_document: Value,
    presets: Vec<FFmpegPreset>,
    app_version: String,
) -> Result<ConfigBundleExportResult> {
    let exported_at_ms = now_ms();
    let preset_count = presets.len();
    let bundle = ConfigBundle {
        schema_version: CONFIG_BUNDLE_SCHEMA_VERSION,
        app_version,
        exported_at_ms,
        settings_document,
        presets,
    };
    write_json_file(path, &bundle)
        .with_context(|| format!("failed to write config bundle {}", path.display()))?;

    let ConfigBundle { app_version, .. } = bundle;
    Ok(ConfigBundleExportResult {
        path: path.to_string_lossy().into_owned(),
        app_version,
        exported_at_ms,
        preset_count,
    })
}

pub fn read_config_bundle(path: &Path) -> Result<ConfigBundle> {
    let mut raw = read_json_file::<Value>(path)
        .with_context(|| format!("failed to read config bundle {}", path.display()))?;
    if raw.get("schemaVersion").and_then(Value::as_u64) == Some(1) {
        let object = raw
            .as_object_mut()
            .context("Config bundle must be an object")?;
        let legacy = object
            .remove("settings")
            .context("Legacy config bundle is missing settings")?;
        object.insert(
            "settingsDocument".into(),
            serde_json::json!({"version": 1, "settings": legacy}),
        );
    }
    let bundle: ConfigBundle =
        serde_json::from_value(raw).context("failed to decode config bundle")?;
    validate_config_bundle(&bundle)?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use crate::ffui_core::AppSettings;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn export_and_read_retain_unknown_settings_document_content() {
        let directory = tempdir().expect("directory");
        let path = directory.path().join("bundle.json");
        let document = serde_json::json!({"version":2,"metadata":{"future":"keep"},"futureRoot":true,"settings":{"locale":"en","unknown":[{"value":1}]}});
        export_config_bundle(&path, document.clone(), vec![], "test".into()).expect("export");
        let loaded = read_config_bundle(&path).expect("read export");
        assert_eq!(loaded.settings_document, document);
    }

    #[test]
    fn schema_one_bundle_import_retains_its_full_settings_payload() {
        let directory = tempdir().expect("directory");
        let path = directory.path().join("legacy.json");
        let settings = serde_json::json!({"locale":"zh-CN","unknown":[1,2],"queueOutputPolicy":{"container":{"mode":"force","format":"mp3"}}});
        write_json_file(&path, &serde_json::json!({"schemaVersion":1,"appVersion":"0.3.5","exportedAtMs":1,"settings":settings,"presets":[]})).expect("legacy bundle");
        let loaded = read_config_bundle(&path).expect("legacy import");
        assert_eq!(loaded.settings_document["settings"], settings);
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.settings_document["version"], 1);
        let snapshot = SettingsStore::inspect_document(&loaded.settings_document)
            .expect("legacy settings projection");
        assert_eq!(
            serde_json::to_value(snapshot.settings.queue_output_policy.container)
                .expect("container projection"),
            serde_json::json!({"mode":"byMedia","audio":"mp3"})
        );
    }

    #[test]
    fn export_bundle_writes_metadata() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("bundle.json");
        let settings = serde_json::json!({"version": 2, "settings": AppSettings::default()});
        let presets = vec![];

        let result = export_config_bundle(&path, settings, presets, "0.0.0-test".to_string())
            .expect("export bundle");
        assert_eq!(result.path, path.to_string_lossy());
        assert_eq!(result.app_version, "0.0.0-test");
        assert!(result.exported_at_ms > 0);
    }

    #[test]
    fn read_bundle_rejects_wrong_schema() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("bundle.json");
        let bundle = ConfigBundle {
            schema_version: 99,
            app_version: "0.0.0-test".to_string(),
            exported_at_ms: 1,
            settings_document: serde_json::json!({"version": 2, "settings": AppSettings::default()}),
            presets: vec![],
        };
        write_json_file(&path, &bundle).expect("write test bundle");
        let err = read_config_bundle(&path).expect_err("schema mismatch should fail");
        assert!(err.to_string().contains("unsupported config bundle schema"));
    }

    #[test]
    fn read_bundle_rejects_invalid_tool_path() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("bundle.json");
        let mut settings = AppSettings::default();
        settings.tools.ffmpeg_path = Some(format!("ffui-missing-tool-{}", std::process::id()));
        let bundle = ConfigBundle {
            schema_version: CONFIG_BUNDLE_SCHEMA_VERSION,
            app_version: "0.0.0-test".to_string(),
            exported_at_ms: 1,
            settings_document: serde_json::json!({"version": 2, "settings": settings}),
            presets: vec![],
        };
        write_json_file(&path, &bundle).expect("write test bundle");
        let err = read_config_bundle(&path).expect_err("invalid tool path should fail");
        assert!(err.to_string().contains("invalid Ffmpeg path"));
    }
}
