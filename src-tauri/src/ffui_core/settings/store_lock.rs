use anyhow::{Context, Result};
use std::path::Path;

pub(super) struct StoreLock {
    #[cfg(windows)]
    handle: windows::Win32::Foundation::HANDLE,
    #[cfg(not(windows))]
    directory: std::fs::File,
}

impl StoreLock {
    pub(super) fn acquire(parent: &Path, identity: &str) -> Result<Self> {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Create settings directory {}", parent.display()))?;
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0};
            use windows::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};
            let name: Vec<u16> = format!("Global\\ffui.settings.{identity}")
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let handle = unsafe { CreateMutexW(None, false, windows::core::PCWSTR(name.as_ptr())) }
                .context("Create settings mutex")?;
            let outcome = unsafe { WaitForSingleObject(handle, 10_000) };
            if outcome != WAIT_OBJECT_0 && outcome != WAIT_ABANDONED {
                unsafe {
                    drop(CloseHandle(handle));
                }
                anyhow::bail!("Could not acquire settings mutex: {outcome:?}");
            }
            Ok(Self { handle })
        }
        #[cfg(not(windows))]
        {
            use fs2::FileExt;
            let directory = std::fs::File::open(parent).context("Open settings directory lock")?;
            let started = std::time::Instant::now();
            loop {
                match directory.try_lock_exclusive() {
                    Ok(()) => break,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && started.elapsed().as_secs() < 10 =>
                    {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(error) => {
                        return Err(error).with_context(|| {
                            format!("Acquire settings directory lock {identity}")
                        });
                    }
                }
            }
            Ok(Self { directory })
        }
    }
}

impl Drop for StoreLock {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::Threading::ReleaseMutex;
            drop(ReleaseMutex(self.handle));
            drop(CloseHandle(self.handle));
        }
        #[cfg(not(windows))]
        {
            drop(fs2::FileExt::unlock(&self.directory));
        }
    }
}
