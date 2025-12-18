use super::ui_fonts_types::SystemFontFamily;

pub fn collect_system_font_families() -> Result<Vec<SystemFontFamily>, String> {
    #[cfg(windows)]
    {
        use std::collections::{
            BTreeMap,
            BTreeSet,
        };

        use windows::Win32::Globalization::GetUserDefaultLocaleName;
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FACTORY_TYPE_SHARED,
            DWriteCreateFactory,
            IDWriteFactory,
            IDWriteFontCollection,
            IDWriteLocalizedStrings,
        };
        use windows::Win32::System::Com::{
            COINIT_MULTITHREADED,
            CoInitializeEx,
        };

        fn get_user_locale_name() -> Option<String> {
            // LOCALE_NAME_MAX_LENGTH is 85 incl. null terminator.
            let mut buf = [0u16; 85];
            let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
            if len <= 1 {
                return None;
            }
            Some(String::from_utf16_lossy(&buf[..(len as usize - 1)]))
        }

        fn read_localized_strings(
            strings: &IDWriteLocalizedStrings,
        ) -> Result<Vec<(String, String)>, String> {
            let count = unsafe { strings.GetCount() };
            let mut out: Vec<(String, String)> = Vec::with_capacity(count as usize);
            for index in 0..count {
                let locale_len = unsafe {
                    strings
                        .GetLocaleNameLength(index)
                        .map_err(|e| format!("failed to get locale name length: {e:?}"))?
                };
                let mut locale_buf = vec![0u16; locale_len as usize + 1];
                unsafe {
                    strings
                        .GetLocaleName(index, &mut locale_buf)
                        .map_err(|e| format!("failed to get locale name: {e:?}"))?;
                }
                let locale = String::from_utf16_lossy(&locale_buf[..locale_len as usize])
                    .trim()
                    .to_string();

                let name_len = unsafe {
                    strings
                        .GetStringLength(index)
                        .map_err(|e| format!("failed to get family name length: {e:?}"))?
                };
                let mut name_buf = vec![0u16; name_len as usize + 1];
                unsafe {
                    strings
                        .GetString(index, &mut name_buf)
                        .map_err(|e| format!("failed to get family name: {e:?}"))?;
                }
                let name = String::from_utf16_lossy(&name_buf[..name_len as usize])
                    .trim()
                    .to_string();

                if !name.is_empty() {
                    out.push((locale, name));
                }
            }
            Ok(out)
        }

        fn choose_primary_name(entries: &[(String, String)], user_locale: &str) -> Option<String> {
            let user = user_locale.trim().to_ascii_lowercase();
            if user.is_empty() {
                return None;
            }

            for (locale, name) in entries {
                if locale.trim().to_ascii_lowercase() == user && !name.trim().is_empty() {
                    return Some(name.trim().to_string());
                }
            }

            // Fall back to English names when present.
            for (locale, name) in entries {
                let l = locale.trim().to_ascii_lowercase();
                if (l == "en-us" || l == "en") && !name.trim().is_empty() {
                    return Some(name.trim().to_string());
                }
            }

            None
        }

        // Ensure COM is initialized (DirectWrite depends on it). Ignore mode mismatch.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

        let factory: IDWriteFactory = unsafe { DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED) }
            .map_err(|e| format!("failed to create DirectWrite factory: {e:?}"))?;

        let mut collection: Option<IDWriteFontCollection> = None;
        unsafe {
            factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|e| format!("failed to get system font collection: {e:?}"))?;
        }
        let collection = collection.ok_or_else(|| "system font collection is null".to_string())?;

        let user_locale = get_user_locale_name().unwrap_or_default();
        let mut by_primary: BTreeMap<String, SystemFontFamily> = BTreeMap::new();

        let count = unsafe { collection.GetFontFamilyCount() };
        for index in 0..count {
            let family = unsafe { collection.GetFontFamily(index) }
                .map_err(|e| format!("failed to get font family #{index}: {e:?}"))?;
            let localized = unsafe { family.GetFamilyNames() }
                .map_err(|e| format!("failed to get family localized names: {e:?}"))?;

            let entries = read_localized_strings(&localized)?;
            if entries.is_empty() {
                continue;
            }

            let mut name_set: BTreeSet<String> = BTreeSet::new();
            for (_locale, name) in entries.iter() {
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    name_set.insert(trimmed.to_string());
                }
            }
            if name_set.is_empty() {
                continue;
            }

            let fallback_first = name_set.iter().next().cloned();
            let primary = choose_primary_name(&entries, &user_locale)
                .or(fallback_first)
                .unwrap_or_default();
            let primary_trimmed = primary.trim().to_string();
            if primary_trimmed.is_empty() {
                continue;
            }

            name_set.insert(primary_trimmed.clone());
            let names: Vec<String> = name_set.into_iter().collect();
            let key = primary_trimmed.to_ascii_lowercase();

            by_primary
                .entry(key)
                .and_modify(|existing| {
                    let merged = existing
                        .names
                        .iter()
                        .cloned()
                        .chain(names.iter().cloned())
                        .map(|n| n.trim().to_string())
                        .filter(|n| !n.is_empty())
                        .collect::<BTreeSet<_>>();
                    existing.names = merged.into_iter().collect();
                })
                .or_insert(SystemFontFamily {
                    primary: primary_trimmed,
                    names,
                });
        }

        Ok(by_primary.into_values().collect())
    }

    #[cfg(all(not(windows), not(any(target_os = "android", target_os = "ios"))))]
    {
        use std::collections::BTreeSet;

        use font_kit::source::SystemSource;

        let source = SystemSource::new();
        let handles = source
            .all_fonts()
            .map_err(|e| format!("failed to enumerate system fonts: {e:?}"))?;

        let mut families = BTreeSet::new();
        for handle in handles {
            if let Ok(font) = handle.load() {
                let name = font.family_name();
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    families.insert(trimmed.to_string());
                }
            }
        }

        Ok(families
            .into_iter()
            .map(|name: String| SystemFontFamily {
                primary: name.clone(),
                names: vec![name],
            })
            .collect())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        Ok(Vec::new())
    }
}
