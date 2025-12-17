use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};

use super::ui_fonts_catalog::open_source_fonts_catalog;
use super::ui_fonts_types::{DownloadedFontInfo, UiFontDownloadSnapshot, UiFontDownloadStatus};
use crate::ffui_core::network_proxy;

pub struct UiFontDownloadManager {
    jobs: Mutex<HashMap<String, Arc<UiFontDownloadJob>>>,
    next_session_id: AtomicU64,
}

impl Default for UiFontDownloadManager {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
        }
    }
}

struct UiFontDownloadJob {
    cancel: Arc<AtomicBool>,
    snapshot: Mutex<UiFontDownloadSnapshot>,
}

impl UiFontDownloadJob {
    fn new(session_id: u64, font_id: String, family_name: String, format: String) -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            snapshot: Mutex::new(UiFontDownloadSnapshot {
                session_id,
                font_id,
                status: UiFontDownloadStatus::Starting,
                received_bytes: 0,
                total_bytes: None,
                family_name,
                format,
                path: None,
                error: None,
            }),
        }
    }

    fn mark_cancel_requested(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    fn cancel_requested(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    fn snapshot(&self) -> UiFontDownloadSnapshot {
        self.snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| UiFontDownloadSnapshot {
                session_id: 0,
                font_id: "unknown".to_string(),
                status: UiFontDownloadStatus::Error,
                received_bytes: 0,
                total_bytes: None,
                family_name: "unknown".to_string(),
                format: "ttf".to_string(),
                path: None,
                error: Some("failed to lock download snapshot".to_string()),
            })
    }

    fn update_snapshot<F>(&self, f: F) -> UiFontDownloadSnapshot
    where
        F: FnOnce(&mut UiFontDownloadSnapshot),
    {
        let mut guard = self
            .snapshot
            .lock()
            .expect("ui font download snapshot mutex poisoned");
        f(&mut guard);
        guard.clone()
    }
}

pub fn get_open_source_font_download_snapshot(
    manager: &UiFontDownloadManager,
    font_id: &str,
) -> Option<UiFontDownloadSnapshot> {
    let jobs = manager.jobs.lock().ok()?;
    jobs.get(font_id.trim()).map(|job| job.snapshot())
}

pub fn cancel_open_source_font_download(manager: &UiFontDownloadManager, font_id: &str) -> bool {
    let Ok(jobs) = manager.jobs.lock() else {
        return false;
    };
    let Some(job) = jobs.get(font_id.trim()) else {
        return false;
    };
    job.mark_cancel_requested();
    true
}

pub fn start_open_source_font_download(
    app: tauri::AppHandle,
    manager: &UiFontDownloadManager,
    font_id: &str,
) -> Result<UiFontDownloadSnapshot, String> {
    let id = font_id.trim();
    if id.is_empty() {
        return Err("font id is empty".to_string());
    }

    let entry = open_source_fonts_catalog()
        .into_iter()
        .find(|(entry_id, _, _, _, _)| entry_id == id)
        .ok_or_else(|| format!("unknown font id: {id}"))?;

    let (id, _name, family_name, format, url) = entry;

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app_data_dir: {e}"))?;
    let fonts_dir: PathBuf = base_dir.join("ui-fonts");
    let filename = format!("{id}.{format}");
    let dest = fonts_dir.join(filename);

    if dest.exists() {
        let size = std::fs::metadata(&dest).map(|m| m.len()).ok();
        return Ok(UiFontDownloadSnapshot {
            session_id: 0,
            font_id: id,
            status: UiFontDownloadStatus::Ready,
            received_bytes: size.unwrap_or(0),
            total_bytes: size,
            family_name,
            format,
            path: Some(dest.to_string_lossy().into_owned()),
            error: None,
        });
    }

    let mut jobs = manager
        .jobs
        .lock()
        .map_err(|_| "ui font download manager mutex poisoned".to_string())?;

    if let Some(existing) = jobs.get(&id) {
        let snap = existing.snapshot();
        if snap.status == UiFontDownloadStatus::Starting
            || snap.status == UiFontDownloadStatus::Downloading
        {
            return Ok(snap);
        }
    }

    let session_id = manager.next_session_id.fetch_add(1, Ordering::Relaxed);
    let job = Arc::new(UiFontDownloadJob::new(
        session_id,
        id.clone(),
        family_name.clone(),
        format.clone(),
    ));
    jobs.insert(id.clone(), job.clone());
    drop(jobs);

    let app_for_task = app.clone();
    let fonts_dir_for_task = fonts_dir.clone();
    let dest_for_task = dest.clone();
    let format_for_task = format.clone();
    let job_for_task = job.clone();

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;

        let job = job_for_task;
        if let Err(err) = std::fs::create_dir_all(&fonts_dir_for_task) {
            let snapshot = job.update_snapshot(|s| {
                s.status = UiFontDownloadStatus::Error;
                s.error = Some(format!("failed to create ui-fonts dir: {err}"));
            });
            let _ = app_for_task.emit("ui_font_download", snapshot);
            return;
        }

        let tmp = dest_for_task.with_extension(format!("{format_for_task}.tmp"));
        let mut last_emit_at = Instant::now();

        let emit_snapshot = |job: &Arc<UiFontDownloadJob>| {
            let snapshot = job.snapshot();
            let _ = app_for_task.emit("ui_font_download", snapshot);
        };

        let snapshot = job.update_snapshot(|s| {
            s.status = UiFontDownloadStatus::Downloading;
            s.error = None;
        });
        let _ = app_for_task.emit("ui_font_download", snapshot);

        let outcome: Result<(String, u64, Option<u64>), String> =
            tauri::async_runtime::block_on(async {
                let proxy = network_proxy::resolve_effective_proxy_once();
                let builder = network_proxy::apply_reqwest_builder(
                    reqwest::Client::builder().timeout(Duration::from_secs(300)),
                    &proxy,
                );
                let client = builder
                    .build()
                    .map_err(|e| format!("failed to build HTTP client: {e}"))?;

                let mut resp = client
                    .get(&url)
                    .send()
                    .await
                    .map_err(|e| format!("download failed: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("download failed with status {}", resp.status()));
                }

                let total = resp.content_length();
                job.update_snapshot(|s| s.total_bytes = total);
                emit_snapshot(&job);

                let mut file = std::fs::File::create(&tmp)
                    .map_err(|e| format!("failed to create temp file: {e}"))?;

                let mut received: u64 = 0;
                while let Some(chunk) = resp
                    .chunk()
                    .await
                    .map_err(|e| format!("download read failed: {e}"))?
                {
                    if job.cancel_requested() {
                        drop(file);
                        let _ = std::fs::remove_file(&tmp);
                        return Err("canceled".to_string());
                    }

                    file.write_all(&chunk)
                        .map_err(|e| format!("write failed: {e}"))?;
                    received = received.saturating_add(chunk.len() as u64);

                    if last_emit_at.elapsed() >= Duration::from_millis(120) {
                        last_emit_at = Instant::now();
                        job.update_snapshot(|s| s.received_bytes = received);
                        emit_snapshot(&job);
                    }
                }

                drop(file);
                std::fs::rename(&tmp, &dest_for_task)
                    .map_err(|e| format!("failed to finalize font file: {e}"))?;

                Ok((
                    dest_for_task.to_string_lossy().into_owned(),
                    received,
                    total,
                ))
            });

        match outcome {
            Ok((path, received, total)) => {
                let snapshot = job.update_snapshot(|s| {
                    s.status = UiFontDownloadStatus::Ready;
                    s.path = Some(path);
                    s.received_bytes = received;
                    s.total_bytes = total;
                    s.error = None;
                });
                let _ = app_for_task.emit("ui_font_download", snapshot);
            }
            Err(err) if err == "canceled" => {
                let snapshot = job.update_snapshot(|s| {
                    s.status = UiFontDownloadStatus::Canceled;
                    s.error = None;
                });
                let _ = app_for_task.emit("ui_font_download", snapshot);
            }
            Err(err) => {
                let snapshot = job.update_snapshot(|s| {
                    s.status = UiFontDownloadStatus::Error;
                    s.error = Some(err);
                });
                let _ = app_for_task.emit("ui_font_download", snapshot);
            }
        }
    });

    Ok(job.snapshot())
}

pub fn ensure_open_source_font_downloaded(
    app: tauri::AppHandle,
    font_id: &str,
) -> Result<DownloadedFontInfo, String> {
    use std::fs;
    use std::io::Write;

    let id = font_id.trim();
    if id.is_empty() {
        return Err("font id is empty".to_string());
    }

    let entry = open_source_fonts_catalog()
        .into_iter()
        .find(|(entry_id, _, _, _, _)| entry_id == id)
        .ok_or_else(|| format!("unknown font id: {id}"))?;
    let (id, _name, family_name, format, url) = entry;

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app_data_dir: {e}"))?;
    let fonts_dir: PathBuf = base_dir.join("ui-fonts");
    fs::create_dir_all(&fonts_dir).map_err(|e| format!("failed to create ui-fonts dir: {e}"))?;

    let filename = format!("{id}.{format}");
    let dest = fonts_dir.join(filename);
    if dest.exists() {
        return Ok(DownloadedFontInfo {
            id,
            family_name,
            path: dest.to_string_lossy().into_owned(),
            format,
        });
    }

    let tmp = dest.with_extension(format!("{format}.tmp"));
    tauri::async_runtime::block_on(async {
        let proxy = network_proxy::resolve_effective_proxy_once();
        let builder = network_proxy::apply_reqwest_builder(
            reqwest::Client::builder().timeout(Duration::from_secs(300)),
            &proxy,
        );
        let client = builder
            .build()
            .map_err(|e| format!("failed to build HTTP client: {e}"))?;

        let mut resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("download failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("download failed with status {}", resp.status()));
        }

        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("failed to create temp file: {e}"))?;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("download read failed: {e}"))?
        {
            file.write_all(&chunk)
                .map_err(|e| format!("write failed: {e}"))?;
        }
        drop(file);

        Ok::<(), String>(())
    })?;

    fs::rename(&tmp, &dest).map_err(|e| format!("failed to finalize font file: {e}"))?;

    Ok(DownloadedFontInfo {
        id,
        family_name,
        path: dest.to_string_lossy().into_owned(),
        format,
    })
}
