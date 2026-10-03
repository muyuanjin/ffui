use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Mutex;

use super::{AppSettings, document, io::write_json_file, merge, store_lock::StoreLock};
use crate::sync_ext::MutexExt;

pub use super::document::{SettingsSnapshot, UnavailableSetting};

static STORE_WRITES: Mutex<()> = Mutex::new(());

pub struct SettingsStore {
    path: PathBuf,
    document: document::Document,
}

impl SettingsStore {
    pub fn inspect_document(raw: &Value) -> Result<SettingsSnapshot> {
        Ok(document::decode(
            raw.clone(),
            document::digest(&serde_json::to_vec(raw)?),
            "import".into(),
            true,
        )?
        .snapshot)
    }

    pub fn open() -> Result<Self> {
        let path = crate::ffui_core::data_root::settings_path()?;
        let document = document::read(&path)?;
        Ok(Self { path, document })
    }

    pub fn snapshot(&self) -> SettingsSnapshot {
        self.document.snapshot.clone()
    }

    pub fn document(&self) -> Value {
        self.document.raw.clone()
    }

    pub fn reload(&mut self) -> Result<SettingsSnapshot> {
        self.check_root(&self.document.snapshot.data_root_id)?;
        self.document = document::read(&self.path)?;
        Ok(self.snapshot())
    }

    pub fn update(&mut self, settings: &AppSettings) -> Result<SettingsSnapshot> {
        let base = self.snapshot();
        self.commit(
            &base.settings,
            &base.content_id,
            &base.data_root_id,
            settings,
            false,
        )
    }

    pub fn commit(
        &mut self,
        base_settings: &AppSettings,
        base_content_id: &str,
        data_root_id: &str,
        settings: &AppSettings,
        user_owned: bool,
    ) -> Result<SettingsSnapshot> {
        if base_content_id.is_empty() {
            bail!("Settings content identity must not be empty");
        }
        self.check_root(data_root_id)?;
        let _guard = STORE_WRITES.lock_unpoisoned();
        let parent = self
            .path
            .parent()
            .context("Settings path has no directory")?;
        let _lock = StoreLock::acquire(parent, data_root_id)?;
        let latest = document::read(&self.path)?;
        let mut base = base_settings.clone();
        base.normalize();
        let mut next = settings.clone();
        next.normalize();
        let base = serde_json::to_value(base)?;
        let next = serde_json::to_value(next)?;
        let known = serde_json::to_value(&latest.snapshot.settings)?;
        if base_content_id == latest.snapshot.content_id && base != known {
            bail!("Settings baseline does not match its content identity");
        }
        let mut paths = Vec::new();
        merge::changes(Some(&base), Some(&next), "", &mut paths);
        for unavailable in &latest.snapshot.unavailable_settings {
            if unavailable.path.is_empty()
                || paths
                    .iter()
                    .any(|path| merge::overlaps(path, &unavailable.path))
            {
                bail!(
                    "Settings are read-only at {}: {}",
                    unavailable.path,
                    unavailable.reason
                );
            }
        }
        for path in &paths {
            if !next.pointer(path).is_some_and(Value::is_object)
                && (latest
                    .unknown_fields
                    .iter()
                    .any(|unknown| unknown.starts_with(&format!("{path}/")))
                    || latest
                        .raw
                        .get("settings")
                        .unwrap_or(&latest.raw)
                        .pointer(path)
                        .zip(known.pointer(path))
                        .is_some_and(|(raw, known)| merge::has_unprojected_mode_fields(raw, known)))
            {
                bail!("Settings contain unsupported data at {path}; cannot replace its container");
            }
            if user_owned
                && [
                    "/tools/downloaded",
                    "/tools/probeCache",
                    "/tools/remoteVersionCache",
                ]
                .iter()
                .any(|owned| merge::overlaps(path, owned))
            {
                bail!("Settings field is owned by the backend: {path}");
            }
            if known.pointer(path) != base.pointer(path)
                && known.pointer(path) != next.pointer(path)
            {
                bail!("Settings conflict at {path}; reload before retrying");
            }
        }
        if paths.is_empty() && latest.exists {
            self.document = latest;
            return Ok(self.snapshot());
        }
        let mut raw = envelope(&latest.raw)?;
        if latest.legacy {
            migrate_legacy_containers(&mut raw, &latest)?;
        }
        for path in paths {
            merge::materialize_parents(&mut raw["settings"], &known, &path)?;
            merge::assign(
                &mut raw["settings"],
                &path,
                known.pointer(&path),
                next.pointer(&path),
            )?;
        }
        self.write(raw)
    }

    pub fn import_document(&mut self, incoming: Value) -> Result<SettingsSnapshot> {
        let decoded =
            document::decode(incoming, String::new(), self.snapshot().data_root_id, true)?;
        if decoded
            .snapshot
            .unavailable_settings
            .iter()
            .any(|entry| entry.path.is_empty())
        {
            bail!("Cannot import an unsupported settings file version");
        }
        let root = self.snapshot().data_root_id;
        self.check_root(&root)?;
        let _guard = STORE_WRITES.lock_unpoisoned();
        let _lock = StoreLock::acquire(self.path.parent().context("Settings directory")?, &root)?;
        let latest = document::read(&self.path)?;
        if latest
            .snapshot
            .unavailable_settings
            .iter()
            .any(|entry| entry.path.is_empty())
        {
            bail!("Current settings file is read-only");
        }
        let mut raw = envelope(&latest.raw)?;
        if latest.legacy {
            migrate_legacy_containers(&mut raw, &latest)?;
        }
        let mut incoming = envelope(&decoded.raw)?;
        if decoded.legacy {
            migrate_legacy_containers(&mut incoming, &decoded)?;
        }
        merge_import(&mut raw, &incoming);
        self.write(raw)
    }

    pub fn reset() -> Result<Self> {
        let path = crate::ffui_core::data_root::settings_path()?;
        let root = document::root_identity(&path)?;
        let _guard = STORE_WRITES.lock_unpoisoned();
        let _lock = StoreLock::acquire(path.parent().context("Settings directory")?, &root)?;
        let document = document::decode(
            json!({"version": document::VERSION, "settings": {}}),
            "missing".into(),
            root,
            false,
        )?;
        let mut store = Self { path, document };
        store.write(json!({"version": document::VERSION, "settings": {}}))?;
        Ok(store)
    }

    fn write(&mut self, mut raw: Value) -> Result<SettingsSnapshot> {
        raw["version"] = json!(document::VERSION);
        if raw.get("metadata").is_none() {
            raw["metadata"] = json!({});
        }
        let metadata = raw["metadata"]
            .as_object_mut()
            .context("settings metadata must be an object")?;
        metadata.insert("writerVersion".into(), json!(env!("CARGO_PKG_VERSION")));
        metadata.insert("savedAt".into(), json!(chrono::Utc::now().to_rfc3339()));
        let bytes = serde_json::to_vec_pretty(&raw)?;
        let document = document::decode(
            raw.clone(),
            document::digest(&bytes),
            self.snapshot().data_root_id,
            true,
        )?;
        write_json_file(&self.path, &raw)?;
        self.document = document;
        Ok(self.snapshot())
    }

    fn check_root(&self, expected: &str) -> Result<()> {
        let active = crate::ffui_core::data_root::settings_path()?;
        if document::root_identity(&active)? != expected || self.snapshot().data_root_id != expected
        {
            bail!("Settings data directory changed; reload before saving");
        }
        Ok(())
    }
}

fn envelope(raw: &Value) -> Result<Value> {
    let object = raw
        .as_object()
        .context("Settings document must be an object")?;
    if object.contains_key("settings") {
        return Ok(raw.clone());
    }
    let mut payload = object.clone();
    payload.remove("version");
    let metadata = payload.remove("metadata");
    let mut result = json!({"version": document::VERSION, "settings": payload});
    if let Some(metadata) = metadata {
        result["metadata"] = metadata;
    }
    Ok(result)
}

fn migrate_legacy_containers(raw: &mut Value, source: &document::Document) -> Result<()> {
    let payload = source.raw.get("settings").unwrap_or(&source.raw);
    let known = serde_json::to_value(&source.snapshot.settings)?;
    for path in [
        "/queueOutputPolicy/container",
        "/batchCompressDefaults/outputPolicy/container",
    ] {
        if source
            .snapshot
            .unavailable_settings
            .iter()
            .any(|entry| merge::overlaps(path, &entry.path))
        {
            continue;
        }
        if let Some(previous) = payload.pointer(path) {
            let parsed: crate::ffui_core::domain::OutputContainerPolicy =
                serde_json::from_value(previous.clone())?;
            let before = serde_json::to_value(parsed)?;
            merge::assign(
                &mut raw["settings"],
                path,
                Some(&before),
                known.pointer(path),
            )?;
        }
    }
    Ok(())
}

fn merge_import(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge_import(target.entry(key.clone()).or_insert(Value::Null), value);
        }
    } else {
        *target = source.clone();
    }
}
