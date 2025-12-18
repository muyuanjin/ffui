//! 本测试禁止修改或跳过，必须运行，用于防止单个后端源码文件超过500行，请通过重构拆分解决。

use std::fs;
use std::path::{
    Path,
    PathBuf,
};

const THRESHOLD: usize = 500;
const NOTE: &str =
    "本测试禁止修改或跳过，必须运行，用于防止单个后端源码文件超过500行，请通过重构拆分解决。";

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            collect_rs_files(&path, out)?;
        } else if metadata.is_file() && path.extension().and_then(|s| s.to_str()) == Some("rs") {
            out.push(path);
        }
    }
    Ok(())
}

#[test]
fn backend_source_files_should_not_exceed_threshold() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let src_root = crate_root.join("src");
    assert!(src_root.exists(), "{NOTE} 未找到后端源码目录: {src_root:?}");

    let mut files = Vec::new();
    collect_rs_files(&src_root, &mut files).expect("读取后端源码目录失败");

    let build_rs = crate_root.join("build.rs");
    if build_rs.exists() {
        files.push(build_rs);
    }

    let mut over_limit: Vec<(String, usize)> = files
        .into_iter()
        .filter_map(|path| {
            let content = fs::read_to_string(&path).ok()?;
            let lines = content.lines().count();
            if lines > THRESHOLD {
                let relative = path
                    .strip_prefix(crate_root)
                    .unwrap_or(&path)
                    .display()
                    .to_string();
                Some((relative, lines))
            } else {
                None
            }
        })
        .collect();

    over_limit.sort_by(|a, b| b.1.cmp(&a.1));

    if !over_limit.is_empty() {
        let details = over_limit
            .iter()
            .map(|(path, lines)| format!("{path}: {lines} 行（超出 {} 行）", lines - THRESHOLD))
            .collect::<Vec<_>>()
            .join("\n");

        panic!("{NOTE}\n以下后端文件需拆分（>{THRESHOLD} 行）：\n{details}");
    }
}
