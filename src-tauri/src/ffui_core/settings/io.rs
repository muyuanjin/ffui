use std::fs;
use std::io::{BufReader, Write};
use std::path::Path;

use crate::sync_ext::MutexExt;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tempfile::Builder;

static JSON_REPLACE_LOCK: Mutex<()> = Mutex::new(());

/// Reads and deserializes a JSON file into the specified type.
///
/// # Arguments
///
/// * `path` - The path to the JSON file to read
///
/// # Returns
///
/// A `Result<T>` containing the deserialized value or an error if reading or parsing fails.
pub(crate) fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let file = fs::File::open(path)
        .with_context(|| format!("failed to open config file {}", path.display()))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader)
        .with_context(|| format!("failed to parse JSON from {}", path.display()))
}

/// Writes and serializes a value to a JSON file atomically.
///
/// Creates the parent directory if it doesn't exist, writes to a temporary file first,
/// then atomically renames it to the target path to ensure data consistency.
///
/// # Arguments
///
/// * `path` - The path where the JSON file should be written
/// * `value` - The value to serialize and write
///
/// # Returns
///
/// A `Result<()>` indicating success or an error if any step fails.
pub(crate) fn write_json_file<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut tmp = Builder::new()
        .prefix(".ffui-json-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .with_context(|| format!("failed to create temp file in {}", parent.display()))?;
    let tmp_path = tmp.path().to_path_buf();
    {
        let mut writer = std::io::BufWriter::new(tmp.as_file_mut());
        serde_json::to_writer_pretty(&mut writer, value)
            .with_context(|| format!("failed to write JSON to {}", tmp_path.display()))?;
        writer
            .flush()
            .with_context(|| format!("failed to flush {}", tmp_path.display()))?;
    }
    tmp.as_file()
        .sync_all()
        .with_context(|| format!("failed to sync {}", tmp_path.display()))?;
    let _guard = JSON_REPLACE_LOCK.lock_unpoisoned();
    drop(tmp.persist(path).map_err(|err| {
        anyhow::anyhow!(
            "failed to atomically replace {}: {}",
            path.display(),
            err.error
        )
    })?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn concurrent_json_replacements_leave_valid_complete_json_and_no_temporary_files() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("settings.json");
        let barrier = Arc::new(Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|worker| {
                let path = path.clone();
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    for iteration in 0..50 {
                        barrier.wait();
                        write_json_file(
                            &path,
                            &serde_json::json!({"worker": worker, "iteration": iteration}),
                        )
                        .expect("concurrent atomic write");
                        barrier.wait();
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().expect("worker");
        }
        let value: serde_json::Value = read_json_file(&path).expect("complete JSON");
        assert_eq!(value["iteration"], 49);
        assert_eq!(fs::read_dir(directory.path()).expect("entries").count(), 1);
    }

    #[test]
    fn failed_replacement_preserves_target_and_removes_only_its_temporary_file() {
        let directory = tempfile::tempdir().expect("directory");
        let target = directory.path().join("occupied");
        fs::create_dir(&target).expect("occupied target");
        fs::write(target.join("keep"), "user content").expect("user file");
        let error = write_json_file(&target, &serde_json::json!({"preset": "audio"}))
            .expect_err("replacement must fail");
        assert!(error.to_string().contains("failed to atomically replace"));
        assert_eq!(
            fs::read_to_string(target.join("keep")).expect("kept file"),
            "user content"
        );
        assert_eq!(fs::read_dir(directory.path()).expect("entries").count(), 1);
    }
}
