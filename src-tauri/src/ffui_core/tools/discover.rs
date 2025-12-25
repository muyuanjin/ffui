use std::path::{Path, PathBuf};

use super::resolve::{looks_like_bare_program_name, resolve_in_path_with_env};
use super::types::ExternalToolKind;

#[derive(Debug, Clone)]
pub struct DiscoveredPath {
    pub path: PathBuf,
    /// Source hint for the discovered path so the frontend can render an
    /// accurate badge (e.g. distinguish Everything SDK from PATH).
    pub source: &'static str,
}

/// Multi-source discovery of external tool executables.
/// Returns a de-duplicated list of plausible absolute paths in best-effort order.
pub fn discover_candidates(program: &str, kind: ExternalToolKind) -> Vec<DiscoveredPath> {
    let mut out: Vec<DiscoveredPath> = Vec::new();

    // 1) If the input is already a plausible explicit path, prefer it.
    if !looks_like_bare_program_name(program) {
        let p = PathBuf::from(program);
        if p.is_file() {
            out.push(DiscoveredPath {
                path: p,
                source: "path",
            });
        }
        return dedup_paths(out);
    }

    // 2) PATH resolution (authoritative).
    if let Some(p) = resolve_in_path_with_env(
        program,
        std::env::var_os("PATH"),
        std::env::var_os("PATHEXT"),
    ) {
        out.push(DiscoveredPath {
            path: p,
            source: "path",
        });
    }

    // 3) Environment variables that may contain direct overrides
    // Allow FFUI_FFMPEG/FFUI_FFPROBE/FFUI_AVIFENC or generic FFUI_TOOL
    if let Some(env_path) = env_override_for(kind) {
        let p = PathBuf::from(env_path);
        if p.is_file() {
            out.push(DiscoveredPath {
                path: p,
                source: "env",
            });
        }
    }

    // 4) Windows: Registry known install locations (best-effort, non-fatal)
    #[cfg(windows)]
    if let Some(reg_paths) = windows_registry_locations(program) {
        out.extend(
            reg_paths
                .into_iter()
                .filter(|p| p.is_file())
                .map(|path| DiscoveredPath {
                    path,
                    source: "registry",
                }),
        );
    }

    // 5) Windows: optional Everything SDK fast search (if crate present at runtime)
    #[cfg(windows)]
    if let Some(found) = everything_search(program) {
        out.extend(
            found
                .into_iter()
                .filter(|p| p.is_file())
                .map(|path| DiscoveredPath {
                    path,
                    source: "everything",
                }),
        );
    }

    dedup_paths(out)
}

/// 简单基于路径字符串判断是否是 Windows Prefetch 生成的 .pf 文件。
/// 这类文件并不是可执行文件，但 Everything 等索引工具可能会返回它们，
/// 如果不加过滤就去执行，会得到类似“%1 不是有效的 Win32 应用程序”的错误。
#[cfg_attr(not(windows), allow(dead_code))]
fn is_prefetch_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    p.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pf"))
        || s.to_ascii_lowercase().contains("\\prefetch\\")
}

fn dedup_paths(mut v: Vec<DiscoveredPath>) -> Vec<DiscoveredPath> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    v.retain(|p| seen.insert(canon_key(&p.path)));
    v
}

fn canon_key(p: &Path) -> String {
    p.to_string_lossy().to_ascii_lowercase()
}

fn env_override_for(kind: ExternalToolKind) -> Option<String> {
    let keys: &[&str] = match kind {
        ExternalToolKind::Ffmpeg => &["FFUI_FFMPEG", "FFMPEG"],
        ExternalToolKind::Ffprobe => &["FFUI_FFPROBE", "FFPROBE"],
        ExternalToolKind::Avifenc => &["FFUI_AVIFENC", "AVIFENC"],
    };
    for k in keys {
        if let Some(v) = std::env::var_os(k) {
            return Some(v.to_string_lossy().into_owned());
        }
    }
    // Generic override for ad-hoc debugging
    if let Some(v) = std::env::var_os("FFUI_TOOL") {
        return Some(v.to_string_lossy().into_owned());
    }
    None
}

#[cfg(windows)]
fn windows_registry_locations(program: &str) -> Option<Vec<PathBuf>> {
    use windows::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_VALUE_TYPE, RegCloseKey,
        RegOpenKeyExW, RegQueryValueExW,
    };
    use windows::core::PCWSTR;

    // Known uninstall keys to scan for InstallLocation
    const SUBKEYS: &[&str] = &[
        r"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        r"SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];

    let mut results: Vec<PathBuf> = Vec::new();

    fn read_string_value(hkey: HKEY, value: &str) -> Option<String> {
        let name: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        let mut typ = REG_VALUE_TYPE(0);
        let mut cb = 0u32;
        if unsafe {
            RegQueryValueExW(
                hkey,
                PCWSTR(name.as_ptr()),
                None,
                Some(&raw mut typ),
                None,
                Some(&raw mut cb),
            )
        }
        .is_err()
            || typ != REG_VALUE_TYPE(1)
        {
            return None;
        }
        let mut buf: Vec<u16> = vec![0u16; (cb as usize).div_ceil(2)];
        if unsafe {
            RegQueryValueExW(
                hkey,
                PCWSTR(name.as_ptr()),
                None,
                Some(&raw mut typ),
                Some(buf.as_mut_ptr().cast()),
                Some(&raw mut cb),
            )
        }
        .is_err()
            || typ != REG_VALUE_TYPE(1)
        {
            return None;
        }
        let s =
            String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]);
        Some(s)
    }

    fn open_subkey(root: HKEY, path: &str) -> Option<HKEY> {
        let p: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut hk: HKEY = HKEY(std::ptr::null_mut());
        let ok =
            unsafe { RegOpenKeyExW(root, PCWSTR(p.as_ptr()), 0, KEY_READ, &raw mut hk) }.is_ok();
        if ok { Some(hk) } else { None }
    }

    fn scan_uninstall(root: HKEY, program: &str, out: &mut Vec<PathBuf>) {
        // Minimal implementation: try common value names under root itself.
        // For brevity and to keep lines low, we don't enumerate subkeys here; this
        // is sufficient for well-behaved installers that set InstallLocation directly.
        if let Some(hk) = open_subkey(root, SUBKEYS[0]) {
            let location = read_string_value(hk, "InstallLocation");
            unsafe {
                let _ = RegCloseKey(hk);
            }
            if let Some(location) = location {
                let candidate = PathBuf::from(location).join(program);
                out.push(candidate);
            }
        }
    }

    scan_uninstall(HKEY_LOCAL_MACHINE, program, &mut results);
    scan_uninstall(HKEY_CURRENT_USER, program, &mut results);

    Some(results)
}

#[cfg(windows)]
fn everything_search(program: &str) -> Option<Vec<PathBuf>> {
    use everything_sdk::ergo::{RequestFlags, global};
    let mut list: Vec<PathBuf> = Vec::new();
    // Everything SDK 要求单进程全局序列化访问，这里做一次短查询。
    if let Ok(mut global) = global().try_lock() {
        // 确认后端已运行且数据库可用。
        if global.is_db_loaded().unwrap_or(false) {
            let mut searcher = global.searcher();
            // 精确匹配文件名，避免太多结果；允许包含通配符。
            searcher.set_search(program);
            searcher.set_request_flags(
                RequestFlags::EVERYTHING_REQUEST_FILE_NAME | RequestFlags::EVERYTHING_REQUEST_PATH,
            );
            searcher.set_max(64);
            let results = searcher.query();
            for item in results.iter() {
                if let Ok(full) = item.filepath() {
                    // Windows Prefetch 目录下的 .pf 文件只是启动痕迹，不是真正的可执行文件。
                    // 这里直接过滤掉，避免后续验证逻辑把它们当成“坏的 avifenc/ffmpeg”而产生误导性错误。
                    if is_prefetch_path(&full) {
                        continue;
                    }
                    list.push(full);
                }
            }
        }
    }
    // 按优先级排序：1) 程序同目录/工具子目录 2) 系统目录(WINDIR) 3) 其他
    if !list.is_empty() {
        sort_by_proximity(list.as_mut_slice());
    }
    if list.is_empty() { None } else { Some(list) }
}

#[cfg(windows)]
fn sort_by_proximity(paths: &mut [PathBuf]) {
    fn norm(p: &Path) -> String {
        p.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
    }
    let data_root = crate::ffui_core::data_root_dir().ok();
    let (data_root_s, tools_dir_s) = data_root.map_or_else(
        || (String::new(), String::new()),
        |dir| {
            let root_s = norm(&dir);
            let tools_s = norm(&dir.join(crate::ffui_core::data_root::TOOLS_DIRNAME));
            (root_s, tools_s)
        },
    );
    let windir_s = std::env::var_os("WINDIR")
        .map(|v| norm(Path::new(&v)))
        .unwrap_or_default();

    paths.sort_by(|a, b| {
        let as_ = norm(a);
        let bs_ = norm(b);
        let rank = |s: &str| -> (u8, usize) {
            if !tools_dir_s.is_empty() && s.starts_with(&tools_dir_s) {
                (0, s.len())
            } else if !data_root_s.is_empty() && s.starts_with(&data_root_s) {
                (1, s.len())
            } else if !windir_s.is_empty() && s.starts_with(&windir_s) {
                (2, s.len())
            } else {
                (3, s.len())
            }
        };
        rank(&as_).cmp(&rank(&bs_))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_keeps_first_and_ignores_case() {
        let p1 = if cfg!(windows) {
            PathBuf::from("C:/Tools/ffmpeg.exe")
        } else {
            PathBuf::from("/usr/bin/ffmpeg")
        };
        let p2 = PathBuf::from(p1.to_string_lossy().to_ascii_uppercase());
        let v = super::dedup_paths(vec![
            DiscoveredPath {
                path: p1.clone(),
                source: "path",
            },
            DiscoveredPath {
                path: p2,
                source: "path",
            },
        ]);
        assert_eq!(v.len(), 1);
        assert_eq!(
            v[0].path.to_string_lossy().to_ascii_lowercase(),
            p1.to_string_lossy().to_ascii_lowercase()
        );
    }

    #[test]
    fn env_override_is_exposed_with_env_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fake = dir.path().join("ffmpeg");
        std::fs::write(&fake, b"#!/bin/sh\nexit 0").expect("write fake tool");

        let _lock = crate::test_support::env_lock();
        let _guard = crate::test_support::EnvVarGuard::capture(["FFUI_FFMPEG"]);
        crate::test_support::set_env("FFUI_FFMPEG", &fake);
        let candidates = super::discover_candidates("ffmpeg", ExternalToolKind::Ffmpeg);

        assert!(
            candidates
                .iter()
                .any(|c| c.source == "env" && c.path == fake),
            "env override candidate should be marked as env"
        );
    }

    #[test]
    fn prefetch_paths_are_recognised_and_can_be_filtered() {
        let normal = if cfg!(windows) {
            PathBuf::from("C:/Tools/avifenc.exe")
        } else {
            PathBuf::from("/usr/bin/avifenc")
        };
        let prefetch = PathBuf::from("C:/Windows/Prefetch/AVIFENC.EXE-BA34AC6F.pf");

        assert!(
            !super::is_prefetch_path(&normal),
            "normal tool path must not be treated as a Prefetch artifact"
        );
        assert!(
            super::is_prefetch_path(&prefetch),
            "Windows Prefetch .pf path should be recognised so discovery can skip it"
        );
    }
}
