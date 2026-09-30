use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 手动入队的展开结果。
///
/// `skipped` 是必需的：提示只能建立在展开结果上。只看原始路径时，目录没有扩展名，
/// 会被误判成视频，于是「添加一个音乐专辑文件夹」会一声不吭地什么都不做——
/// 这正是 issue #2 的体验。这里把「有多少输入被跳过」显式带出去。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ExpandedManualJobInputs {
    pub accepted: Vec<String>,
    pub skipped: usize,
}

fn push_unique(out: &mut Vec<String>, seen: &mut HashSet<String>, path: &Path) {
    let s = path.to_string_lossy().into_owned();
    if seen.insert(s.clone()) {
        out.push(s);
    }
}

/// 读目录并按名称稳定排序；返回 `None` 表示这个目录读不到，调用方要把它计入被跳过，
/// 否则用户只会看到「拖进来什么都没发生」。
fn list_dir_sorted(dir: &Path) -> Option<Vec<PathBuf>> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();

    // Stable order: case-insensitive lexicographic by the final path segment.
    entries.sort_by_cached_key(|p| {
        let name = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        (name.to_ascii_lowercase(), name)
    });
    Some(entries)
}

fn expand_dir(
    dir: &Path,
    recursive: bool,
    out: &mut Vec<String>,
    seen: &mut HashSet<String>,
    skipped: &mut usize,
) {
    let Some(entries) = list_dir_sorted(dir) else {
        // 目录读不到：它一个输入都没贡献，必须让用户看到原因而不是静默。
        *skipped += 1;
        return;
    };
    for path in entries {
        let Ok(meta) = fs::symlink_metadata(&path) else {
            *skipped += 1;
            continue;
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            // 手动展开只取真实文件；符号链接计为被跳过，否则用户看到的是「什么都没发生」。
            *skipped += 1;
            continue;
        }

        if file_type.is_dir() {
            if recursive {
                expand_dir(&path, recursive, out, seen, skipped);
            }
            continue;
        }

        if !file_type.is_file() {
            // 设备、FIFO、socket 之类：不是队列的输入，但要记账。
            *skipped += 1;
            continue;
        }

        push_unique(out, seen, &path);
    }
}

/// Expand a list of user-provided input paths (files and directories) into an
/// ordered, de-duplicated list of regular file paths plus how many
/// inputs were skipped: symlinks, non-regular files, unreadable
/// directories and paths that no longer exist.
///
/// Ordering rules:
/// - Input paths are processed in the provided order.
/// - Directories are expanded in a stable, deterministic order (case-insensitive lexicographic by
///   entry name) so results are predictable across runs.
pub(crate) fn expand_manual_job_inputs(
    paths: &[String],
    recursive: bool,
) -> ExpandedManualJobInputs {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut skipped: usize = 0;

    for raw in paths {
        if raw.is_empty() {
            skipped += 1;
            continue;
        }
        let path = PathBuf::from(raw);
        let Ok(meta) = fs::symlink_metadata(&path) else {
            // 路径不存在或读不到：既不能入队，也不该静默。
            skipped += 1;
            continue;
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            skipped += 1;
            continue;
        }

        if file_type.is_dir() {
            expand_dir(&path, recursive, &mut out, &mut seen, &mut skipped);
            continue;
        }

        if file_type.is_file() {
            push_unique(&mut out, &mut seen, &path);
        } else {
            skipped += 1;
        }
    }

    ExpandedManualJobInputs {
        accepted: out,
        skipped,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;

    use tempfile::tempdir;

    use super::{expand_dir, expand_manual_job_inputs};

    #[test]
    fn expands_regular_files_in_stable_name_order() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        fs::write(root.join("b.txt"), b"no").expect("write b.txt");
        fs::write(root.join("c.mkv"), b"yes").expect("write c.mkv");
        fs::write(root.join("a.mp4"), b"yes").expect("write a.mp4");
        fs::write(root.join("d.mp3"), b"yes").expect("write d.mp3");
        fs::write(root.join("e.png"), b"yes").expect("write e.png");

        let paths = vec![root.to_string_lossy().to_string()];
        let expanded = expand_manual_job_inputs(&paths, true);

        let names: Vec<String> = expanded
            .accepted
            .iter()
            .map(|p| p.rsplit(['/', '\\']).next().unwrap_or_default().to_string())
            .collect();
        assert_eq!(names, vec!["a.mp4", "b.txt", "c.mkv", "d.mp3", "e.png"]);
        assert_eq!(expanded.skipped, 0);
    }

    #[test]
    fn accepts_audio_image_and_video_files_without_media_gating() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        let audio = root.join("song.flac");
        let image = root.join("photo.avif");
        let video = root.join("clip.webm");
        fs::write(&audio, b"yes").expect("write audio");
        fs::write(&image, b"yes").expect("write image");
        fs::write(&video, b"yes").expect("write video");

        let paths = vec![
            audio.to_string_lossy().to_string(),
            image.to_string_lossy().to_string(),
            video.to_string_lossy().to_string(),
        ];
        let expanded = expand_manual_job_inputs(&paths, true);
        assert_eq!(expanded.accepted, paths);
        assert_eq!(expanded.skipped, 0);
    }

    #[test]
    fn preserves_unknown_extensions_spaces_and_deduplicates() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        let text = root.join(" notes.unknown ");
        fs::write(&text, b"no").expect("write text");

        let paths = vec![text.to_string_lossy().to_string(); 2];
        let expanded = expand_manual_job_inputs(&paths, true);
        assert_eq!(expanded.accepted, vec![paths[0].clone()]);
        assert_eq!(expanded.skipped, 0);
    }

    #[test]
    fn expands_audio_album_without_videos() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        // 音乐专辑目录：一个视频都没有，但绝不能表现为「什么都没发生」。
        fs::write(root.join("01.flac"), b"yes").expect("write flac");
        fs::write(root.join("02.mp3"), b"yes").expect("write mp3");
        fs::write(root.join("cover.png"), b"yes").expect("write cover");

        let paths = vec![root.to_string_lossy().to_string()];
        let expanded = expand_manual_job_inputs(&paths, true);
        assert_eq!(expanded.accepted.len(), 3);
        assert_eq!(expanded.skipped, 0);
    }

    #[test]
    fn counts_symlinks_and_missing_paths_as_skipped() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        let real = root.join("real.mp4");
        fs::write(&real, b"yes").expect("write real");
        let missing = root.join("gone.mp4");

        #[cfg(unix)]
        let (paths, expected_skipped) = {
            let link = root.join("link.mp4");
            std::os::unix::fs::symlink(&real, &link).expect("symlink");
            (
                vec![
                    missing.to_string_lossy().to_string(),
                    link.to_string_lossy().to_string(),
                ],
                2usize,
            )
        };
        #[cfg(not(unix))]
        let (paths, expected_skipped) = (vec![missing.to_string_lossy().to_string()], 1usize);

        let expanded = expand_manual_job_inputs(&paths, true);
        assert!(expanded.accepted.is_empty());
        assert_eq!(
            expanded.skipped, expected_skipped,
            "失效路径与符号链接都要记账"
        );
    }

    #[test]
    fn counts_a_path_that_cannot_be_listed_as_a_skipped_directory() {
        // expand_dir 只接受目录；传普通文件时 read_dir 必然失败，走 list_dir_sorted 的 None 分支。
        // 用 chmod 000 造不可读目录在 root 下无效，所以直接测这条分支。
        let dir = tempdir().expect("tempdir");
        let file = dir.path().join("not-a-directory.mp4");
        fs::write(&file, b"yes").expect("write file");

        let mut out: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut skipped: usize = 0;
        expand_dir(&file, true, &mut out, &mut seen, &mut skipped);

        assert!(out.is_empty());
        assert_eq!(skipped, 1, "读不到的目录必须记账，不能静默");
    }

    #[test]
    fn preserves_input_order_for_multiple_files() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        let first = root.join("first.mp4");
        let second = root.join("second.mkv");
        let third = root.join("third.mp3");
        fs::write(&first, b"yes").expect("write first");
        fs::write(&second, b"yes").expect("write second");
        fs::write(&third, b"yes").expect("write third");

        let paths = vec![
            second.to_string_lossy().to_string(),
            third.to_string_lossy().to_string(),
            first.to_string_lossy().to_string(),
        ];

        let expanded = expand_manual_job_inputs(&paths, true);
        assert_eq!(expanded.accepted, paths);
        assert_eq!(expanded.skipped, 0);
    }
}
