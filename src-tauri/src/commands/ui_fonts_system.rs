pub fn collect_system_font_families() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS};
        use windows::Win32::System::Registry::{
            HKEY, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegEnumValueW, RegOpenKeyExW,
        };
        use windows::core::{PCWSTR, PWSTR};

        const FONTS_KEY: &str = r"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";

        fn open_subkey(root: HKEY, path: &str) -> Result<HKEY, String> {
            let p: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let mut hk: HKEY = HKEY(std::ptr::null_mut());
            unsafe { RegOpenKeyExW(root, PCWSTR(p.as_ptr()), 0, KEY_READ, &mut hk) }
                .ok()
                .map_err(|e| format!("failed to open registry key {path}: {e:?}"))?;
            Ok(hk)
        }

        fn normalize_registry_font_name(value_name: &str) -> Option<String> {
            let mut s = value_name.trim().to_string();
            if s.is_empty() {
                return None;
            }
            // Strip common trailing "(TrueType)" / "(OpenType)" suffixes.
            if s.ends_with(')')
                && let Some(idx) = s.rfind(" (")
            {
                s.truncate(idx);
                s = s.trim().to_string();
            }
            if s.is_empty() { None } else { Some(s) }
        }

        let hk = open_subkey(HKEY_LOCAL_MACHINE, FONTS_KEY)?;
        let mut out: Vec<String> = Vec::new();

        // Enumerate value names.
        let mut index: u32 = 0;
        let mut done = false;
        loop {
            let mut name_buf_len: usize = 256;
            let mut name: Option<String> = None;
            loop {
                let mut name_buf: Vec<u16> = vec![0u16; name_buf_len];
                let mut name_len: u32 = name_buf_len as u32;

                let status = unsafe {
                    RegEnumValueW(
                        hk,
                        index,
                        PWSTR(name_buf.as_mut_ptr()),
                        &mut name_len,
                        None,
                        None,
                        None,
                        None,
                    )
                };

                if status == ERROR_MORE_DATA {
                    name_buf_len = (name_buf_len * 2).min(16 * 1024);
                    continue;
                }
                if status == ERROR_NO_MORE_ITEMS {
                    done = true;
                    break;
                }
                if status.is_err() {
                    break;
                }

                name = Some(String::from_utf16_lossy(&name_buf[..name_len as usize]));
                break;
            }

            if done {
                break;
            }

            if let Some(name) = name
                && let Some(normalized) = normalize_registry_font_name(&name)
            {
                out.push(normalized);
            }

            index += 1;
        }

        unsafe {
            let _ = RegCloseKey(hk);
        }

        out.sort();
        out.dedup();
        Ok(out)
    }

    #[cfg(all(not(windows), not(any(target_os = "android", target_os = "ios"))))]
    {
        use font_kit::source::SystemSource;
        use std::collections::BTreeSet;

        let source = SystemSource::new();
        let handles = source
            .all_fonts()
            .map_err(|e| format!("failed to enumerate system fonts: {e:?}"))?;

        let mut families = BTreeSet::new();
        for handle in handles {
            if let Ok(font) = handle.load() {
                if let Ok(name) = font.family_name() {
                    let trimmed = name.trim();
                    if !trimmed.is_empty() {
                        families.insert(trimmed.to_string());
                    }
                }
            }
        }

        Ok(families.into_iter().collect())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(Vec::new())
    }
}
