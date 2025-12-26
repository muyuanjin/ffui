use std::fs;
use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub(crate) struct FileTimesSnapshot {
    pub(crate) created: Option<SystemTime>,
    pub(crate) accessed: Option<SystemTime>,
    pub(crate) modified: Option<SystemTime>,
}

pub(crate) fn read_file_times(path: &Path) -> FileTimesSnapshot {
    let meta = fs::metadata(path).ok();
    let created = meta.as_ref().and_then(|m| m.created().ok());
    let accessed = meta.as_ref().and_then(|m| m.accessed().ok());
    let modified = meta.as_ref().and_then(|m| m.modified().ok());
    FileTimesSnapshot {
        created,
        accessed,
        modified,
    }
}

pub(crate) fn apply_file_times(path: &Path, times: &FileTimesSnapshot) -> Result<(), String> {
    // Always try to set atime/mtime first (portable). `filetime` requires both values,
    // so for whichever one is not explicitly requested, keep the current value.
    if times.accessed.is_some() || times.modified.is_some() {
        let meta = fs::metadata(path).ok();
        let current_accessed = meta
            .as_ref()
            .and_then(|m| m.accessed().ok())
            .unwrap_or_else(SystemTime::now);
        let current_modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .unwrap_or_else(SystemTime::now);

        let accessed = times.accessed.unwrap_or(current_accessed);
        let modified = times.modified.unwrap_or(current_modified);

        let atime = filetime::FileTime::from_system_time(accessed);
        let mtime = filetime::FileTime::from_system_time(modified);
        filetime::set_file_times(path, atime, mtime).map_err(|e| e.to_string())?;
    }

    // Windows: also try to set creation time when available.
    #[cfg(windows)]
    {
        if let Some(created) = times.created {
            set_creation_time_windows(path, created)?;
        }
    }

    Ok(())
}

#[cfg(windows)]
fn set_creation_time_windows(path: &Path, created: SystemTime) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::time::UNIX_EPOCH;

    // Convert UNIX epoch to Windows FILETIME (100ns intervals since 1601-01-01).
    const WINDOWS_EPOCH_DIFF_SECS: u64 = 11_644_473_600;

    use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FILE_WRITE_ATTRIBUTES, OPEN_EXISTING, SetFileTime,
    };

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let duration = created.duration_since(UNIX_EPOCH).unwrap_or_default();
    let intervals_100ns =
        duration.as_secs().saturating_mul(10_000_000) + (u64::from(duration.subsec_nanos()) / 100);
    let windows_intervals =
        intervals_100ns.saturating_add(WINDOWS_EPOCH_DIFF_SECS.saturating_mul(10_000_000));

    let ft = FILETIME {
        dwLowDateTime: (windows_intervals & 0xFFFF_FFFF) as u32,
        dwHighDateTime: (windows_intervals >> 32) as u32,
    };

    let handle: HANDLE = unsafe {
        CreateFileW(
            windows::core::PCWSTR(wide.as_ptr()),
            FILE_WRITE_ATTRIBUTES.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|e| e.to_string())?;

    let res =
        unsafe { SetFileTime(handle, Some(&raw const ft), None, None) }.map_err(|e| e.to_string());
    unsafe {
        drop(CloseHandle(handle));
    }
    res
}
