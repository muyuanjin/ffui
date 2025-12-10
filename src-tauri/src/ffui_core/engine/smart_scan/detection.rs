use std::path::{Path, PathBuf};

pub(crate) fn is_image_file(path: &Path) -> bool {
    let ext = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        Some(ext) => ext,
        None => return false,
    };
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "bmp" | "tif" | "tiff" | "webp" | "avif"
    )
}

pub(crate) fn is_video_file(path: &Path) -> bool {
    let ext = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        Some(ext) => ext,
        None => return false,
    };
    matches!(
        ext.as_str(),
        "mp4" | "mkv" | "mov" | "avi" | "flv" | "ts" | "m2ts" | "wmv"
    )
}

pub(crate) fn is_audio_file(path: &Path) -> bool {
    let ext = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        Some(ext) => ext,
        None => return false,
    };
    matches!(
        ext.as_str(),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus"
    )
}

pub(crate) fn is_smart_scan_style_output(path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|n| n.to_str()) {
        Some(name) => name.to_ascii_lowercase(),
        None => return false,
    };

    // 所有 .avif 文件都视为潜在 Smart Scan 输出；在实际逻辑中我们已经避免对
    // 这些文件再次发起压缩任务。
    if file_name.ends_with(".avif") {
        return true;
    }

    // 形如 foo.compressed.mp4 或 foo.compressed (1).mp4 等命名，统一视为
    // Smart Scan 风格输出。
    if file_name.contains(".compressed") {
        return true;
    }

    false
}

pub(crate) fn build_image_avif_paths(path: &Path) -> (PathBuf, PathBuf) {
    // 最终 AVIF 目标始终使用 .avif 扩展名，以便系统和工具能够正确识别格式。
    let avif_target = path.with_extension("avif");
    // 临时文件使用 *.tmp.avif，保证 ffmpeg 等工具可根据最后一个扩展名推断为 AVIF。
    let tmp_output = path.with_extension("tmp.avif");
    (avif_target, tmp_output)
}
