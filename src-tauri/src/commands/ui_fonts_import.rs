use std::path::{Path, PathBuf};

use super::ui_fonts_types::DownloadedFontInfo;

const IMPORTED_FONT_ID: &str = "imported";
const IMPORTED_FONT_FAMILY: &str = "FFUI Imported";

fn normalize_font_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.trim().to_lowercase();
    if ext == "ttf" || ext == "otf" {
        return Some(ext);
    }
    None
}

pub fn import_ui_font_file(
    _app: tauri::AppHandle,
    source_path: &str,
) -> Result<DownloadedFontInfo, String> {
    let raw = source_path.trim();
    if raw.is_empty() {
        return Err("font file path is empty".to_string());
    }

    let src = PathBuf::from(raw);
    let ext = normalize_font_extension(&src)
        .ok_or_else(|| "unsupported font format (expected .ttf or .otf)".to_string())?;

    let metadata =
        std::fs::metadata(&src).map_err(|e| format!("failed to stat selected font file: {e}"))?;
    if !metadata.is_file() {
        return Err("selected font path is not a file".to_string());
    }

    let base_dir = crate::ffui_core::ui_fonts_dir()
        .map_err(|e| format!("failed to resolve ui fonts directory: {e}"))?;
    let dest_dir = base_dir.join("imported");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("failed to create imported font dir: {e}"))?;

    let dest = dest_dir.join(format!("{IMPORTED_FONT_ID}.{ext}"));
    if dest.exists() {
        drop(std::fs::remove_file(&dest));
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("failed to copy font file: {e}"))?;

    Ok(DownloadedFontInfo {
        id: IMPORTED_FONT_ID.to_string(),
        family_name: IMPORTED_FONT_FAMILY.to_string(),
        path: dest.to_string_lossy().into_owned(),
        format: ext,
    })
}
