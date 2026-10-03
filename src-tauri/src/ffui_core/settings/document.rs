use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize, de::IntoDeserializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;

use super::{AppSettings, merge};

pub(super) const VERSION: u64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableSetting {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub settings: AppSettings,
    pub content_id: String,
    pub data_root_id: String,
    pub unavailable_settings: Vec<UnavailableSetting>,
}

pub(super) struct Document {
    pub raw: Value,
    pub snapshot: SettingsSnapshot,
    pub legacy: bool,
    pub exists: bool,
    pub unknown_fields: Vec<String>,
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn root_identity(path: &Path) -> Result<String> {
    let parent = path.parent().context("Settings path has no directory")?;
    let absolute = std::path::absolute(parent)?;
    let mut ancestor = absolute.as_path();
    let mut missing = Vec::new();
    while !ancestor.exists() {
        missing.push(
            ancestor
                .file_name()
                .context("Resolve settings directory")?
                .to_owned(),
        );
        ancestor = ancestor.parent().context("Resolve settings directory")?;
    }
    let mut absolute = ancestor
        .canonicalize()
        .context("Resolve settings directory")?;
    for component in missing.into_iter().rev() {
        absolute.push(component);
    }
    let identity = absolute.to_string_lossy().to_string();
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    Ok(digest(identity.as_bytes()))
}

pub(super) fn read(path: &Path) -> Result<Document> {
    let data_root_id = root_identity(path)?;
    match std::fs::read(path) {
        Ok(bytes) => {
            let raw = serde_json::from_slice(&bytes)
                .with_context(|| format!("settings file {} is not valid JSON", path.display()))?;
            decode(raw, digest(&bytes), data_root_id, true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => decode(
            json!({"version": VERSION, "settings": {}}),
            "missing".into(),
            data_root_id,
            false,
        ),
        Err(error) => {
            Err(error).with_context(|| format!("failed to read settings file {}", path.display()))
        }
    }
}

pub(super) fn decode(
    raw: Value,
    content_id: String,
    data_root_id: String,
    exists: bool,
) -> Result<Document> {
    let object = raw
        .as_object()
        .context("settings file must be a JSON object")?;
    if object
        .get("metadata")
        .is_some_and(|value| !value.is_object())
    {
        bail!("settings metadata must be a JSON object");
    }
    let version = match object.get("version") {
        None => 0,
        Some(value) => value
            .as_u64()
            .context("settings file version must be an unsigned integer")?,
    };
    let payload = object.get("settings").unwrap_or(&raw);
    if !payload.is_object() {
        bail!("settings payload must be a JSON object");
    }
    let mut projection = payload.clone();
    if !object.contains_key("settings") {
        projection
            .as_object_mut()
            .expect("settings object")
            .remove("version");
        projection
            .as_object_mut()
            .expect("settings object")
            .remove("metadata");
    }
    let mut unavailable_settings = Vec::new();
    let mut settings = loop {
        let decoded: std::result::Result<AppSettings, _> =
            serde_path_to_error::deserialize(projection.clone().into_deserializer());
        match decoded {
            Ok(settings) => break settings,
            Err(error) if error.inner().to_string().contains("unknown variant") => {
                let mut path = String::new();
                for segment in error.path().iter() {
                    match segment {
                        serde_path_to_error::Segment::Map { key } => {
                            path = merge::pointer_child(&path, key)
                        }
                        serde_path_to_error::Segment::Seq { .. } => break,
                        _ => {}
                    }
                }
                if path.ends_with("/mode") {
                    path.truncate(path.len() - 5);
                }
                if path.is_empty() {
                    return Err(error.into_inner()).context("failed to decode settings");
                }
                let reason = error.inner().to_string();
                let defaults = serde_json::to_value(AppSettings::default())?;
                let previous = projection.pointer(&path).cloned();
                merge::assign(
                    &mut projection,
                    &path,
                    previous.as_ref(),
                    defaults.pointer(&path),
                )?;
                unavailable_settings.push(UnavailableSetting { path, reason });
            }
            Err(error) => return Err(error.into_inner()).context("failed to decode settings"),
        }
    };
    let legacy = version < VERSION || !object.contains_key("settings");
    if legacy {
        settings.queue_output_policy.container = settings
            .queue_output_policy
            .container
            .scoped_for_active_settings();
        settings.batch_compress_defaults.output_policy.container = settings
            .batch_compress_defaults
            .output_policy
            .container
            .scoped_for_active_settings();
    }
    for (key, unknown) in [
        (
            "presetSortMode",
            matches!(
                settings.preset_sort_mode,
                Some(super::types::PresetSortMode::Unknown)
            ),
        ),
        (
            "presetSortDirection",
            matches!(
                settings.preset_sort_direction,
                Some(super::types::PresetSortDirection::Unknown)
            ),
        ),
        (
            "presetViewMode",
            matches!(
                settings.preset_view_mode,
                Some(super::types::PresetViewMode::Unknown)
            ),
        ),
        (
            "presetCardFooter/layout",
            settings.preset_card_footer.as_ref().is_some_and(|footer| {
                matches!(
                    footer.layout,
                    super::types::preset_card_footer::PresetCardFooterLayout::Unknown
                )
            }),
        ),
        (
            "presetCardFooter/order",
            settings
                .preset_card_footer
                .as_ref()
                .and_then(|footer| footer.order.as_ref())
                .is_some_and(|order| {
                    order.contains(
                        &super::types::preset_card_footer::PresetCardFooterItemKey::Unknown,
                    )
                }),
        ),
    ] {
        if unknown {
            unavailable_settings.push(UnavailableSetting {
                path: format!("/{key}"),
                reason: "Unsupported setting value".into(),
            });
        }
    }
    let mut unknown_fields = Vec::new();
    let _: AppSettings = serde_ignored::deserialize(projection.into_deserializer(), |path| {
        unknown_fields.push(ignored_pointer(&path));
    })?;
    settings.normalize();
    let mut arrays = Vec::new();
    for unknown in &unknown_fields {
        let mut parent = unknown.as_str();
        while let Some((ancestor, _)) = parent.rsplit_once('/') {
            if payload.pointer(ancestor).is_some_and(Value::is_array) {
                arrays.push(ancestor.to_string());
            }
            parent = ancestor;
        }
    }
    arrays.sort();
    arrays.dedup();
    unavailable_settings.extend(arrays.into_iter().map(|path| UnavailableSetting {
        path,
        reason: "Array contains unsupported data".into(),
    }));
    if version > VERSION {
        unavailable_settings.push(UnavailableSetting {
            path: "".into(),
            reason: format!("Settings file version {version} is newer than supported {VERSION}"),
        });
    }
    Ok(Document {
        raw,
        snapshot: SettingsSnapshot {
            settings,
            content_id,
            data_root_id,
            unavailable_settings,
        },
        legacy,
        exists,
        unknown_fields,
    })
}

fn ignored_pointer(path: &serde_ignored::Path<'_>) -> String {
    match path {
        serde_ignored::Path::Root => String::new(),
        serde_ignored::Path::Map { parent, key } => {
            merge::pointer_child(&ignored_pointer(parent), key)
        }
        serde_ignored::Path::Seq { parent, index } => {
            merge::pointer_child(&ignored_pointer(parent), &index.to_string())
        }
        serde_ignored::Path::Some { parent }
        | serde_ignored::Path::NewtypeStruct { parent }
        | serde_ignored::Path::NewtypeVariant { parent } => ignored_pointer(parent),
    }
}
