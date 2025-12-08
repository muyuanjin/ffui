use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::time::{Duration, SystemTime};

use super::types::ExternalToolKind;

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileFingerprint {
    len: u64,
    modified_millis: Option<u128>,
}

fn file_fingerprint(path: &str) -> Option<FileFingerprint> {
    let meta = fs::metadata(path).ok()?;
    let len = meta.len();
    let modified_millis = meta.modified().ok().and_then(|t| {
        t.duration_since(SystemTime::UNIX_EPOCH).ok().map(|d| d.as_millis())
    });
    Some(FileFingerprint { len, modified_millis })
}

#[derive(Clone, Debug)]
struct VerifyCacheEntry {
    ok: bool,
    fingerprint: Option<FileFingerprint>,
    last_checked: std::time::Instant,
}

static VERIFY_CACHE: once_cell::sync::Lazy<
    std::sync::Mutex<HashMap<(ExternalToolKind, String), VerifyCacheEntry>>,
> = once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

pub fn cache_lookup(kind: ExternalToolKind, path: &str) -> Option<bool> {
    let key = (kind, path.to_string());
    let fp_now = file_fingerprint(path);
    let map = VERIFY_CACHE.lock().ok()?;
    if let Some(entry) = map.get(&key) {
        if entry.fingerprint.is_some() && entry.fingerprint == fp_now {
            return Some(entry.ok);
        }
        if entry.fingerprint.is_none() && !entry.ok {
            if entry.last_checked.elapsed() < Duration::from_secs(2) {
                return Some(entry.ok);
            }
        }
    }
    None
}

pub fn cache_store(kind: ExternalToolKind, path: &str, ok: bool) {
    let key = (kind, path.to_string());
    let fp = file_fingerprint(path);
    let entry = VerifyCacheEntry { ok, fingerprint: fp, last_checked: std::time::Instant::now() };
    if let Ok(mut map) = VERIFY_CACHE.lock() {
        map.insert(key, entry);
    }
}

#[cfg(windows)]
pub fn current_windows_pe_machine() -> Option<u16> {
    #[cfg(target_arch = "x86_64")]
    { return Some(0x8664); }
    #[cfg(target_arch = "x86")]
    { return Some(0x014c); }
    #[cfg(target_arch = "aarch64")]
    { return Some(0xAA64); }
    #[allow(unreachable_code)]
    None
}

#[cfg(windows)]
pub fn parse_pe_machine(path: &str) -> Option<u16> {
    let mut f = File::open(path).ok()?;
    let mut mz: [u8; 2] = [0, 0];
    f.read_exact(&mut mz).ok()?;
    if mz != [b'M', b'Z'] { return None; }
    f.seek(SeekFrom::Start(0x3C)).ok()?;
    let mut off_buf = [0u8; 4];
    f.read_exact(&mut off_buf).ok()?;
    let pe_off = u32::from_le_bytes(off_buf) as u64;
    f.seek(SeekFrom::Start(pe_off)).ok()?;
    let mut sig = [0u8; 4];
    f.read_exact(&mut sig).ok()?;
    if sig != [b'P', b'E', 0, 0] { return None; }
    let mut machine_buf = [0u8; 2];
    f.read_exact(&mut machine_buf).ok()?;
    Some(u16::from_le_bytes(machine_buf))
}

#[cfg(windows)]
pub fn pe_arch_compatible_with_host(machine: u16) -> bool {
    match (current_windows_pe_machine(), machine) {
        (Some(0x8664), 0x8664) => true,
        (Some(0x014c), 0x014c) => true,
        (Some(0xAA64), 0xAA64) => true,
        (Some(0x8664), 0x014c) => true,
        _ => false,
    }
}

