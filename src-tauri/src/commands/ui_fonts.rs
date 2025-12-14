#[path = "ui_fonts_catalog.rs"]
mod ui_fonts_catalog;
#[path = "ui_fonts_downloads.rs"]
mod ui_fonts_downloads;
#[path = "ui_fonts_import.rs"]
mod ui_fonts_import;
#[path = "ui_fonts_system.rs"]
mod ui_fonts_system;
#[path = "ui_fonts_types.rs"]
mod ui_fonts_types;

pub use ui_fonts_downloads::UiFontDownloadManager;
pub use ui_fonts_types::{DownloadedFontInfo, OpenSourceFontInfo, UiFontDownloadSnapshot};

#[tauri::command]
pub fn list_open_source_fonts() -> Vec<OpenSourceFontInfo> {
    ui_fonts_catalog::open_source_fonts_catalog()
        .into_iter()
        .map(|(id, name, family_name, format, _url)| OpenSourceFontInfo {
            id,
            name,
            family_name,
            format,
        })
        .collect()
}

#[tauri::command]
pub async fn get_system_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(ui_fonts_system::collect_system_font_families)
        .await
        .map_err(|e| format!("failed to join font enumeration task: {e}"))?
}

#[tauri::command]
pub fn get_open_source_font_download_snapshot(
    manager: tauri::State<UiFontDownloadManager>,
    font_id: String,
) -> Option<UiFontDownloadSnapshot> {
    ui_fonts_downloads::get_open_source_font_download_snapshot(&manager, &font_id)
}

#[tauri::command]
pub fn cancel_open_source_font_download(
    manager: tauri::State<UiFontDownloadManager>,
    font_id: String,
) -> bool {
    ui_fonts_downloads::cancel_open_source_font_download(&manager, &font_id)
}

#[tauri::command]
pub fn start_open_source_font_download(
    app: tauri::AppHandle,
    manager: tauri::State<UiFontDownloadManager>,
    font_id: String,
) -> Result<UiFontDownloadSnapshot, String> {
    ui_fonts_downloads::start_open_source_font_download(app, &manager, &font_id)
}

#[tauri::command]
pub fn ensure_open_source_font_downloaded(
    app: tauri::AppHandle,
    font_id: String,
) -> Result<DownloadedFontInfo, String> {
    ui_fonts_downloads::ensure_open_source_font_downloaded(app, &font_id)
}

#[tauri::command]
pub fn import_ui_font_file(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<DownloadedFontInfo, String> {
    ui_fonts_import::import_ui_font_file(app, &source_path)
}
