use std::path::Path;
use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use anyhow::{
    Context,
    Result,
    bail,
};
use serde::{
    Deserialize,
    Serialize,
};

use crate::ffui_core::settings::io::{
    read_json_file,
    write_json_file,
};
use crate::ffui_core::tools::{
    ExternalToolKind,
    verify_tool_binary,
};
use crate::ffui_core::{
    AppSettings,
    FFmpegPreset,
};

pub const CONFIG_BUNDLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigBundle {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at_ms: u64,
    pub settings: AppSettings,
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
    pub settings: AppSettings,
    pub preset_count: usize,
    pub schema_version: u32,
    pub app_version: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate_tool_path(path: &Option<String>, kind: ExternalToolKind) -> Result<()> {
    let trimmed = path.as_deref().unwrap_or("").trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if verify_tool_binary(trimmed, kind, "config-bundle-import") {
        return Ok(());
    }
    bail!("invalid {kind:?} path in imported settings");
}

fn validate_config_bundle(bundle: &ConfigBundle) -> Result<()> {
    if bundle.schema_version != CONFIG_BUNDLE_SCHEMA_VERSION {
        bail!(
            "unsupported config bundle schema {} (expected {})",
            bundle.schema_version,
            CONFIG_BUNDLE_SCHEMA_VERSION
        );
    }
    validate_tool_path(&bundle.settings.tools.ffmpeg_path, ExternalToolKind::Ffmpeg)?;
    validate_tool_path(
        &bundle.settings.tools.ffprobe_path,
        ExternalToolKind::Ffprobe,
    )?;
    validate_tool_path(
        &bundle.settings.tools.avifenc_path,
        ExternalToolKind::Avifenc,
    )?;
    Ok(())
}

pub fn export_config_bundle(
    path: &Path,
    settings: AppSettings,
    presets: Vec<FFmpegPreset>,
    app_version: String,
) -> Result<ConfigBundleExportResult> {
    let mut normalized_settings = settings.clone();
    normalized_settings.normalize();
    let exported_at_ms = now_ms();
    let bundle = ConfigBundle {
        schema_version: CONFIG_BUNDLE_SCHEMA_VERSION,
        app_version: app_version.clone(),
        exported_at_ms,
        settings: normalized_settings,
        presets,
    };
    write_json_file(path, &bundle)
        .with_context(|| format!("failed to write config bundle {}", path.display()))?;
    Ok(ConfigBundleExportResult {
        path: path.to_string_lossy().into_owned(),
        app_version,
        exported_at_ms,
        preset_count: bundle.presets.len(),
    })
}

pub fn read_config_bundle(path: &Path) -> Result<ConfigBundle> {
    let bundle = read_json_file::<ConfigBundle>(path)
        .with_context(|| format!("failed to read config bundle {}", path.display()))?;
    validate_config_bundle(&bundle)?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn export_bundle_writes_metadata() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("bundle.json");
        let settings = AppSettings::default();
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
            settings: AppSettings::default(),
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
            settings,
            presets: vec![],
        };
        write_json_file(&path, &bundle).expect("write test bundle");
        let err = read_config_bundle(&path).expect_err("invalid tool path should fail");
        assert!(err.to_string().contains("invalid Ffmpeg path"));
    }
}
