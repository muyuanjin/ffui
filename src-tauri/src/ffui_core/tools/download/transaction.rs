use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result, anyhow};

use super::super::resolve::{tool_binary_name, tools_dir};
use super::super::types::ExternalToolKind;

static STAGING_NONCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct ToolInstallTransaction {
    #[cfg(test)]
    pub(super) staging_dir: PathBuf,
    #[cfg(not(test))]
    staging_dir: PathBuf,
}

impl ToolInstallTransaction {
    pub(super) fn new(kind: ExternalToolKind) -> Result<Self> {
        let root = tools_dir()?.join(".staging");
        std::fs::create_dir_all(&root)
            .with_context(|| format!("failed to create staging root {}", root.display()))?;

        let nonce = STAGING_NONCE.fetch_add(1, Ordering::Relaxed);
        let staging_dir = root.join(format!(
            "{}-{}-{nonce}",
            tool_binary_name(kind),
            std::process::id()
        ));
        std::fs::create_dir(&staging_dir)
            .with_context(|| format!("failed to create staging dir {}", staging_dir.display()))?;

        Ok(Self { staging_dir })
    }

    pub(super) fn path(&self, filename: &str) -> PathBuf {
        self.staging_dir.join(filename)
    }
}

impl Drop for ToolInstallTransaction {
    fn drop(&mut self) {
        drop(std::fs::remove_dir_all(&self.staging_dir));
    }
}

fn backup_existing_tool_binary(dest_path: &Path) -> Result<Option<PathBuf>> {
    if !dest_path.exists() {
        return Ok(None);
    }

    let backup_path = dest_path.with_extension("bak");
    match std::fs::remove_file(&backup_path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(err).with_context(|| {
                format!(
                    "failed to remove stale backup before installing {}",
                    dest_path.display()
                )
            });
        }
    }

    std::fs::rename(dest_path, &backup_path).with_context(|| {
        format!(
            "failed to move existing tool binary to backup: {} -> {}",
            dest_path.display(),
            backup_path.display()
        )
    })?;
    Ok(Some(backup_path))
}

fn restore_backup(dest_path: &Path, backup_path: &Path) -> Result<()> {
    drop(std::fs::remove_file(dest_path));
    std::fs::rename(backup_path, dest_path).with_context(|| {
        format!(
            "failed to restore previous tool binary: {} -> {}",
            backup_path.display(),
            dest_path.display()
        )
    })
}

pub(super) fn install_verified_staged_binary(
    kind: ExternalToolKind,
    staged_path: &Path,
    dest_path: &Path,
    verify: impl Fn(&Path, ExternalToolKind, &str) -> bool,
) -> Result<()> {
    if !verify(staged_path, kind, "download") {
        return Err(anyhow!(
            "downloaded {tool} binary failed verification before install; refusing to keep it",
            tool = tool_binary_name(kind)
        ));
    }

    let backup_path = backup_existing_tool_binary(dest_path)?;
    if let Err(err) = std::fs::rename(staged_path, dest_path) {
        if let Some(backup) = &backup_path {
            restore_backup(dest_path, backup)?;
        }
        return Err(err).with_context(|| {
            format!(
                "failed to move freshly downloaded {tool} into place: {} -> {}",
                staged_path.display(),
                dest_path.display(),
                tool = tool_binary_name(kind)
            )
        });
    }

    if !verify(dest_path, kind, "download") {
        drop(std::fs::remove_file(dest_path));
        if let Some(backup) = &backup_path {
            restore_backup(dest_path, backup)?;
        }
        return Err(anyhow!(
            "installed {tool} binary failed verification after install; restored previous binary",
            tool = tool_binary_name(kind)
        ));
    }

    if let Some(backup) = &backup_path {
        drop(std::fs::remove_file(backup));
    }

    Ok(())
}
