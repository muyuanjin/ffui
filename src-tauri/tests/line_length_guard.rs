//! 本测试禁止修改或跳过，必须运行，用于防止单个后端源码文件过长。
//! 门禁限制有效代码行，同时给物理行数设置较宽上限，避免惩罚解释关键不变量的注释。

use std::fs;
use std::path::{Path, PathBuf};

const SOURCE_SLOC_THRESHOLD: usize = 500;
const SOURCE_PHYSICAL_THRESHOLD: usize = 650;
const TEST_SLOC_THRESHOLD: usize = 2000;
const TEST_PHYSICAL_THRESHOLD: usize = 2600;
const NOTE: &str = "本测试禁止修改或跳过，必须运行，用于防止单个后端源码文件过长：源码文件最多500行有效代码/650行物理行；专门测试文件路径（tests/ 或 *_test(s).rs / tests.rs）最多2000行有效代码/2600行物理行，请通过重构拆分解决。";

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

fn is_dedicated_test_path(path: &Path) -> bool {
    if path.components().any(|c| c.as_os_str() == "tests") {
        return true;
    }

    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    file_name == "tests.rs" || file_name.ends_with("_test.rs") || file_name.ends_with("_tests.rs")
}

#[derive(Clone, Copy)]
struct Thresholds {
    sloc: usize,
    physical: usize,
}

#[derive(Clone, Copy)]
struct LineCounts {
    sloc: usize,
    physical: usize,
}

fn thresholds_for_path(path: &Path) -> Thresholds {
    if is_dedicated_test_path(path) {
        Thresholds {
            sloc: TEST_SLOC_THRESHOLD,
            physical: TEST_PHYSICAL_THRESHOLD,
        }
    } else {
        Thresholds {
            sloc: SOURCE_SLOC_THRESHOLD,
            physical: SOURCE_PHYSICAL_THRESHOLD,
        }
    }
}

fn effective_code_line_count(content: &str) -> usize {
    let mut sloc = 0usize;
    let mut in_block_comment = false;

    for line in content.lines() {
        let mut rest = line.trim();

        loop {
            if rest.is_empty() {
                break;
            }

            if in_block_comment {
                if let Some(end) = rest.find("*/") {
                    rest = rest[end + 2..].trim_start();
                    in_block_comment = false;
                    continue;
                }
                break;
            }

            if rest.starts_with("//") {
                break;
            }

            if rest.starts_with("/*") {
                if let Some(end) = rest[2..].find("*/") {
                    rest = rest[end + 4..].trim_start();
                    continue;
                }
                in_block_comment = true;
                break;
            }

            sloc = sloc.saturating_add(1);
            break;
        }
    }

    sloc
}

fn line_counts(content: &str) -> LineCounts {
    LineCounts {
        sloc: effective_code_line_count(content),
        physical: content.lines().count(),
    }
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

    let mut over_limit: Vec<(String, LineCounts, Thresholds)> = files
        .into_iter()
        .filter_map(|path| {
            let content = fs::read_to_string(&path).ok()?;
            let counts = line_counts(&content);
            let thresholds = thresholds_for_path(&path);

            if counts.sloc > thresholds.sloc || counts.physical > thresholds.physical {
                let relative = path
                    .strip_prefix(crate_root)
                    .unwrap_or(&path)
                    .display()
                    .to_string();
                Some((relative, counts, thresholds))
            } else {
                None
            }
        })
        .collect();

    over_limit.sort_by_key(|(_, counts, _)| std::cmp::Reverse(counts.sloc.max(counts.physical)));

    if !over_limit.is_empty() {
        let details = over_limit
            .iter()
            .map(|(path, counts, thresholds)| {
                let sloc_extra = counts.sloc.saturating_sub(thresholds.sloc);
                let physical_extra = counts.physical.saturating_sub(thresholds.physical);
                format!(
                    "{path}: 有效代码 {} 行（超出 {sloc_extra} 行，阈值 {}）；物理 {} 行（超出 {physical_extra} 行，阈值 {}）",
                    counts.sloc, thresholds.sloc, counts.physical, thresholds.physical
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        panic!(
            "{NOTE}\n以下后端文件需拆分（源码>{SOURCE_SLOC_THRESHOLD} 行有效代码或>{SOURCE_PHYSICAL_THRESHOLD} 行物理行；测试>{TEST_SLOC_THRESHOLD} 行有效代码或>{TEST_PHYSICAL_THRESHOLD} 行物理行）：\n{details}"
        );
    }
}

#[test]
fn effective_code_line_count_ignores_comment_only_lines() {
    let content = r#"
// line comment
/// doc comment
/* block
   block */
pub fn demo() {} // trailing comment counts
/* inline block */ pub fn second() {}
"#;

    assert_eq!(effective_code_line_count(content), 2);
}
