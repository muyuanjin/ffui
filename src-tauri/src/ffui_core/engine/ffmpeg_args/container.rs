/// 与容器相关的辅助函数。
///
/// 注意：
/// - UI/预设中经常使用更直观的容器标识（如 `mkv`）；
/// - ffmpeg 期望的是 muxer 名称（如 `matroska`）；
/// - 文件扩展名则更偏向用户习惯（`mkv`、`mp4`、`webm` 等）。
///
/// 本模块负责在三者之间做最小但稳定的映射。
pub(crate) fn normalize_container_format(format: &str) -> String {
    let trimmed = format.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // NOTE: This function maps user-facing extensions/aliases to ffmpeg muxer
    // names. The caller is responsible for selecting the output filename
    // extension separately.
    match trimmed.to_ascii_lowercase().as_str() {
        // Matroska: common extension is mkv but ffmpeg muxer is matroska.
        "mkv" | "matroska" => "matroska",
        // MPEG-TS: both ts and m2ts use the same muxer.
        "ts" | "m2ts" | "mpegts" => "mpegts",
        // WMV is typically muxed via ASF.
        "wmv" | "asf" => "asf",
        // M4A is an mp4-family container; ffmpeg expects mp4 as the muxer name.
        "m4a" | "mp4" => "mp4",
        // RealMedia family (rm/rmvb) is handled by the "rm" muxer.
        "rm" | "rmvb" => "rm",
        // Pass-through known muxers.
        "mov" => "mov",
        "webm" => "webm",
        "flv" => "flv",
        "avi" => "avi",
        "mxf" => "mxf",
        "3gp" => "3gp",
        "ogg" => "ogg",
        "opus" => "opus",
        "mp3" => "mp3",
        "wav" => "wav",
        "aiff" => "aiff",
        "ac3" => "ac3",
        "flac" => "flac",
        // Unknown: keep as-is (may already be a valid muxer name).
        other => other,
    }
    .to_string()
}

/// 根据预设中的容器格式与原始输入扩展名推导输出文件扩展名。
///
/// 约定：
/// - 当 `container_format` 已知时优先使用它；
/// - 未设置或未知时退回到输入扩展名；
/// - 最终始终返回不带前导点的扩展名（如 `mp4`、`mkv`）。
pub(crate) fn infer_output_extension(
    container_format: Option<&str>,
    input_extension: Option<&str>,
) -> String {
    if let Some(fmt) = container_format {
        let lower = fmt.trim().to_ascii_lowercase();
        if !lower.is_empty() {
            let ext = match lower.as_str() {
                // 常见单文件容器
                "mp4" => "mp4",
                "mkv" | "matroska" => "mkv",
                "mov" => "mov",
                "webm" => "webm",
                "flv" => "flv",
                "avi" => "avi",
                "mxf" => "mxf",
                "3gp" => "3gp",
                "asf" | "wmv" => "wmv",
                "rm" | "rmvb" => "rmvb",
                // Audio-only containers / muxers
                "m4a" => "m4a",
                "mp3" => "mp3",
                "aac" | "adts" => "aac",
                "wav" => "wav",
                "flac" => "flac",
                "aiff" => "aiff",
                "ac3" => "ac3",
                "ogg" => "ogg",
                "opus" => "opus",
                // 传输流 / 直播
                "mpegts" | "ts" => "ts",
                "hls" => "m3u8",
                "dash" => "mpd",
                // 未覆盖的其它容器：退回到输入扩展名
                _ => input_extension.unwrap_or("mp4"),
            };
            return ext.to_string();
        }
    }

    // 没有容器信息时，沿用输入扩展名；再退回到 mp4。
    input_extension.unwrap_or("mp4").to_string()
}
