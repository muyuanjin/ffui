use std::fs;
use std::path::{
    Path,
    PathBuf,
};
use std::sync::{
    Arc,
    RwLock,
};
use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use anyhow::{
    Context,
    Result,
};
use once_cell::sync::OnceCell;
use serde::{
    Deserialize,
    Serialize,
};

mod meta;
mod migration;
mod resolve;

#[cfg(test)]
mod tests;

pub const SETTINGS_FILENAME: &str = "ffui.settings.json";
pub const PRESETS_FILENAME: &str = "ffui.presets.json";
pub const QUEUE_STATE_FILENAME: &str = "ffui.queue-state.json";
pub const META_FILENAME: &str = "meta.json";
pub const QUEUE_LOGS_DIRNAME: &str = "queue-logs";
pub const PREVIEWS_DIRNAME: &str = "previews";
pub const TOOLS_DIRNAME: &str = "tools";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataRootMode {
    System,
    Portable,
}

#[derive(Debug, Clone)]
struct DataRootState {
    desired_mode: DataRootMode,
    effective_mode: DataRootMode,
    fallback_active: bool,
    fallback_notice_pending: bool,
    data_root: PathBuf,
    system_root: PathBuf,
    portable_root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRootInfo {
    pub desired_mode: DataRootMode,
    pub effective_mode: DataRootMode,
    pub data_root: String,
    pub system_root: String,
    pub portable_root: String,
    pub fallback_active: bool,
    pub fallback_notice_pending: bool,
    pub switch_pending: bool,
}

static DATA_ROOT_STATE: OnceCell<Arc<RwLock<DataRootState>>> = OnceCell::new();

#[cfg(test)]
static DATA_ROOT_OVERRIDE: once_cell::sync::Lazy<RwLock<Option<PathBuf>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(None));
#[cfg(test)]
static DATA_ROOT_OVERRIDE_LOCK: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn set_global_state(state: DataRootState) -> Arc<RwLock<DataRootState>> {
    let lock = DATA_ROOT_STATE
        .get_or_init(|| Arc::new(RwLock::new(state.clone())))
        .clone();
    if let Ok(mut guard) = lock.write() {
        *guard = state;
    }
    lock
}

pub fn init_data_root(app: &tauri::AppHandle) -> Result<DataRootInfo> {
    let context = resolve::data_root_context_from_app(app)?;
    let state = resolve::resolve_data_root_with(&context, resolve::is_dir_writable)?;
    migration::migrate_legacy_sidecars(&state, &context.exe_dir);
    set_global_state(state.clone());
    Ok(to_info(&state))
}

pub fn data_root_dir() -> Result<PathBuf> {
    #[cfg(test)]
    {
        if let Ok(override_path) = DATA_ROOT_OVERRIDE.read()
            && let Some(path) = override_path.as_ref()
        {
            return Ok(path.clone());
        }
    }
    let lock = DATA_ROOT_STATE
        .get()
        .context("data root is not initialized")?;
    let guard = lock
        .read()
        .map_err(|_| anyhow::anyhow!("data root lock poisoned"))?;
    Ok(guard.data_root.clone())
}

pub fn data_root_info() -> Result<DataRootInfo> {
    let lock = DATA_ROOT_STATE
        .get()
        .context("data root is not initialized")?;
    let guard = lock
        .read()
        .map_err(|_| anyhow::anyhow!("data root lock poisoned"))?;
    Ok(to_info(&guard))
}

pub fn settings_path() -> Result<PathBuf> {
    Ok(data_root_dir()?.join(SETTINGS_FILENAME))
}

pub fn presets_path() -> Result<PathBuf> {
    Ok(data_root_dir()?.join(PRESETS_FILENAME))
}

pub fn queue_state_path() -> Result<PathBuf> {
    Ok(data_root_dir()?.join(QUEUE_STATE_FILENAME))
}

pub fn queue_logs_dir() -> Result<PathBuf> {
    Ok(data_root_dir()?.join(QUEUE_LOGS_DIRNAME))
}

pub fn previews_dir() -> Result<PathBuf> {
    Ok(data_root_dir()?.join(PREVIEWS_DIRNAME))
}

pub fn tools_dir() -> Result<PathBuf> {
    let dir = data_root_dir()?.join(TOOLS_DIRNAME);
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create tools directory {}", dir.display()))?;
    Ok(dir)
}

fn ensure_safe_data_root(root: &Path) -> Result<()> {
    let normalized = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if normalized.parent().is_none() {
        anyhow::bail!("data root must not be filesystem root");
    }
    Ok(())
}

pub fn clear_app_data_root() -> Result<()> {
    let root = data_root_dir()?;
    ensure_safe_data_root(&root)?;

    let files = [
        SETTINGS_FILENAME,
        PRESETS_FILENAME,
        QUEUE_STATE_FILENAME,
        META_FILENAME,
    ];
    for name in files {
        let path = root.join(name);
        if path.is_file() {
            let _ = fs::remove_file(&path);
        }
    }

    let dirs = [QUEUE_LOGS_DIRNAME, PREVIEWS_DIRNAME, TOOLS_DIRNAME];
    for name in dirs {
        let path = root.join(name);
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        }
    }

    Ok(())
}

pub fn acknowledge_fallback_notice() -> Result<()> {
    let lock = DATA_ROOT_STATE
        .get()
        .context("data root is not initialized")?;
    let mut guard = lock
        .write()
        .map_err(|_| anyhow::anyhow!("data root lock poisoned"))?;
    if !guard.fallback_active {
        return Ok(());
    }
    if guard.fallback_notice_pending {
        guard.fallback_notice_pending = false;
        let meta = meta::DataRootMeta {
            schema_version: 1,
            desired_mode: Some(guard.desired_mode),
            last_selected_at_ms: Some(now_ms()),
            fallback_notice_dismissed: Some(true),
        };
        if let Err(err) = meta::write_meta(&guard.system_root, &meta) {
            eprintln!(
                "failed to acknowledge data root fallback notice {}: {err:#}",
                meta::meta_path(&guard.system_root).display()
            );
        }
    }
    Ok(())
}

pub fn set_desired_mode(mode: DataRootMode) -> Result<DataRootInfo> {
    let lock = DATA_ROOT_STATE
        .get()
        .context("data root is not initialized")?;
    let mut guard = lock
        .write()
        .map_err(|_| anyhow::anyhow!("data root lock poisoned"))?;
    let portable_writable = resolve::is_dir_writable(&guard.portable_root);
    let fallback_active = matches!(mode, DataRootMode::Portable)
        && matches!(guard.effective_mode, DataRootMode::System)
        && !portable_writable;
    let fallback_notice_pending = fallback_active;
    let meta_root = if matches!(mode, DataRootMode::Portable) && portable_writable {
        &guard.portable_root
    } else {
        &guard.system_root
    };
    let meta = meta::DataRootMeta {
        schema_version: 1,
        desired_mode: Some(mode),
        last_selected_at_ms: Some(now_ms()),
        fallback_notice_dismissed: Some(false),
    };
    if let Err(err) = meta::write_meta(meta_root, &meta) {
        eprintln!(
            "failed to persist data root preference {}: {err:#}",
            meta::meta_path(meta_root).display()
        );
    }
    let next_effective = guard.effective_mode;
    let next_root = guard.data_root.clone();
    if mode != guard.desired_mode {
        let target_root = if matches!(mode, DataRootMode::Portable) {
            guard.portable_root.clone()
        } else {
            guard.system_root.clone()
        };
        if target_root != guard.data_root {
            migration::migrate_data_root_snapshot(&guard.data_root, &target_root);
        }
    }

    guard.desired_mode = mode;
    guard.effective_mode = next_effective;
    guard.data_root = next_root;
    guard.fallback_active = fallback_active;
    guard.fallback_notice_pending = fallback_notice_pending;

    Ok(to_info(&guard))
}

fn to_info(state: &DataRootState) -> DataRootInfo {
    let switch_pending = state.desired_mode != state.effective_mode && !state.fallback_active;
    DataRootInfo {
        desired_mode: state.desired_mode,
        effective_mode: state.effective_mode,
        data_root: state.data_root.to_string_lossy().into_owned(),
        system_root: state.system_root.to_string_lossy().into_owned(),
        portable_root: state.portable_root.to_string_lossy().into_owned(),
        fallback_active: state.fallback_active,
        fallback_notice_pending: state.fallback_notice_pending,
        switch_pending,
    }
}

#[cfg(test)]
pub fn override_data_root_dir_for_tests(dir: PathBuf) -> DataRootOverrideGuard {
    let lock = DATA_ROOT_OVERRIDE_LOCK
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let mut guard = DATA_ROOT_OVERRIDE
        .write()
        .unwrap_or_else(|err| err.into_inner());
    *guard = Some(dir);
    DataRootOverrideGuard { _lock: lock }
}

#[cfg(test)]
pub struct DataRootOverrideGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(test)]
impl Drop for DataRootOverrideGuard {
    fn drop(&mut self) {
        let mut guard = DATA_ROOT_OVERRIDE
            .write()
            .unwrap_or_else(|err| err.into_inner());
        *guard = None;
    }
}
