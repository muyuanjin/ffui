#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

/// Given an ordered list of candidate media paths, return the first one that
/// currently exists as a regular file on disk.
///
/// The frontend uses this to make preview/video playback more robust when
/// users delete or rename original/transcoded files after a job has finished:
/// - Completed jobs normally prefer the final output path.
/// - When the output file was deleted but the original input still exists, this helper
///   automatically falls back to the input file.
/// - For in‑flight jobs we can prefer temporary outputs when present.
#[tauri::command]
pub fn select_playable_media_path(candidate_paths: Vec<String>) -> Option<String> {
    use std::fs;
    use std::path::Path;

    // 记录首个非空候选，若所有存在性检查都失败仍可兜底返回，避免前端拿到 None。
    let mut first_non_empty: Option<String> = None;

    for raw in candidate_paths {
        // 允许调用方传入带空白的路径（例如用户复制粘贴时留下的空格），这里统一去除前后空白。
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }

        let candidate = trimmed.to_string();
        if first_non_empty.is_none() {
            first_non_empty = Some(candidate.clone());
        }

        let path = Path::new(&candidate);

        // We only treat existing regular files as playable targets; this
        // avoids accidentally returning directories or other special nodes.

        #[cfg(windows)]
        let mut metadata = fs::metadata(path);
        #[cfg(not(windows))]
        let metadata = fs::metadata(path);

        // Windows 在超长路径或 UNC 路径下容易因为缺少 \\?\ 前缀导致 is_file 误判，
        // 失败时尝试一次扩展路径再检查，尽量减少“明明存在却判定不存在”的情况。
        #[cfg(windows)]
        if metadata.is_err()
            && let Some(long_path) = build_windows_extended_path(path)
        {
            metadata = fs::metadata(&long_path);
        }

        match metadata {
            Ok(meta) if meta.is_file() => return Some(candidate),
            Ok(_) => {}
            Err(err) => {
                eprintln!("select_playable_media_path: 跳过不可用路径 {candidate}: {err}");
            }
        }
    }

    first_non_empty
}

/// 在 Windows 上为路径加上扩展长度前缀，避免超长/UNC 路径在常规 API 下判定失败。
#[cfg(windows)]
fn build_windows_extended_path(path: &Path) -> Option<PathBuf> {
    use std::path::PathBuf;

    let raw = path.to_string_lossy();

    // 已经是扩展路径则直接返回 None，让调用方保持原有错误。
    if raw.starts_with(r"\\?\") {
        return None;
    }

    // 统一使用反斜杠，避免混合分隔符导致的奇怪路径。
    let normalized = raw.replace('/', "\\");

    if normalized.starts_with(r"\\") {
        // UNC 形如 \\server\share\path => \\?\UNC\server\share\path
        let trimmed = normalized.trim_start_matches('\\');
        return Some(PathBuf::from(format!(r"\\?\UNC\{trimmed}")));
    }

    // 普通盘符路径形如 C:\path => \\?\C:\path
    Some(PathBuf::from(format!(r"\\?\{normalized}")))
}
