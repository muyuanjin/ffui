use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result, bail};

use super::super::preview_common::acquire_inflight_lock;

const WORKSPACE_PREFIX: &str = ".ffui-preview-";
const WORKSPACE_OWNER: &[u8] = b"ffui-media-preview-workspace-v1\n";

pub(super) struct TemporaryPreview {
    file: fs::File,
    lease: fs::File,
    directory: tempfile::TempDir,
}

impl TemporaryPreview {
    pub(super) fn new(frames: &Path) -> Result<Self> {
        let directory = tempfile::Builder::new()
            .prefix(WORKSPACE_PREFIX)
            .tempdir_in(frames)?;
        let mut lease = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(directory.path().join("lease"))?;
        fs2::FileExt::try_lock_exclusive(&lease).context("reserve media preview workspace")?;
        lease.write_all(WORKSPACE_OWNER)?;
        lease.flush()?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(directory.path().join("output.part"))?;
        Ok(Self {
            file,
            lease,
            directory,
        })
    }

    pub(super) fn path(&self) -> PathBuf {
        self.directory.path().join("output.part")
    }

    pub(super) fn as_file(&self) -> &fs::File {
        &self.file
    }

    pub(super) fn publish(self, destination: &Path) -> Result<()> {
        fs::rename(self.path(), destination).context("publish compatible media preview")?;
        drop(self.file);
        drop(self.lease);
        self.directory
            .close()
            .context("release media preview workspace")
    }
}

fn remove_owned_file(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("remove abandoned preview file {}", path.display()))
        }
    }
}

fn reclaim_workspace(path: &Path) -> Result<()> {
    if !path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(WORKSPACE_PREFIX))
    {
        return Ok(());
    }
    let marker = path.join("lease");
    let metadata = match fs::symlink_metadata(&marker) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("inspect media preview workspace owner"),
    };
    if metadata.len() != WORKSPACE_OWNER.len() as u64 {
        return Ok(());
    }
    let mut lease = match fs::OpenOptions::new().read(true).write(true).open(&marker) {
        Ok(lease) => lease,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("open media preview workspace owner"),
    };
    match fs2::FileExt::try_lock_exclusive(&lease) {
        Ok(()) => {}
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            return Ok(());
        }
        Err(error) => return Err(error).context("lock media preview workspace owner"),
    }
    let mut owner = Vec::new();
    (&mut lease)
        .take(WORKSPACE_OWNER.len() as u64 + 1)
        .read_to_end(&mut owner)?;
    if owner != WORKSPACE_OWNER {
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if !entry.file_type()?.is_file()
            || !matches!(entry.file_name().to_str(), Some("lease" | "output.part"))
        {
            return Ok(());
        }
    }
    remove_owned_file(&path.join("output.part"))?;
    drop(lease);
    remove_owned_file(&marker)?;
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("remove abandoned media preview workspace"),
    }
}

pub(super) fn lock(root: &Path) -> Arc<Mutex<()>> {
    acquire_inflight_lock(&format!("playback-cache:{}", root.display()))
}

fn owned(path: &Path) -> bool {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    stem.len() == 16
        && stem.bytes().all(|value| value.is_ascii_hexdigit())
        && matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("m4a" | "png")
        )
}

pub(super) fn reclaim(root: &Path, retained: Option<&Path>, budget: u64) -> Result<()> {
    let frames = root.join("frames");
    if !frames.exists() {
        return Ok(());
    }
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let now = SystemTime::now();
    for entry in fs::read_dir(frames)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            reclaim_workspace(&path)?;
            continue;
        }
        if !owned(&path) || !entry.file_type()?.is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = metadata.modified()?;
        let expired = now.duration_since(modified).unwrap_or_default()
            > Duration::from_secs(7 * 24 * 60 * 60);
        if retained != Some(path.as_path()) && expired && fs::remove_file(&path).is_ok() {
            continue;
        }
        entries.push((path, metadata.len(), modified));
    }
    let mut total: u64 = entries.iter().map(|(_, size, _)| size).sum();
    entries.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in entries {
        if total <= budget {
            break;
        }
        if retained != Some(path.as_path()) && fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    if total > budget {
        bail!("media preview cache capacity unavailable; close other previews or clear the cache");
    }
    Ok(())
}

#[cfg(test)]
mod tests;
