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

    match trimmed {
        "mkv" => "matroska",
        _ => trimmed,
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
