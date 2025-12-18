use std::fs;
use std::io::Cursor;
use std::path::Path;

use anyhow::{
    Context,
    Result,
    anyhow,
};

pub(crate) fn extract_avifenc_from_zip(data: &[u8], dest: &Path) -> Result<()> {
    let reader = Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(reader).context("failed to open downloaded avifenc zip archive")?;

    let mut found_index: Option<usize> = None;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .with_context(|| format!("failed to read zip entry at index {i}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();

        #[cfg(windows)]
        let is_avifenc = name.to_ascii_lowercase().ends_with("avifenc.exe");

        #[cfg(not(windows))]
        let is_avifenc = {
            let lower = name.to_ascii_lowercase();
            if !lower.ends_with("avifenc") {
                false
            } else {
                lower
                    .rsplit('/')
                    .next()
                    .map(|seg| seg == "avifenc")
                    .unwrap_or(false)
            }
        };

        if is_avifenc {
            found_index = Some(i);
            break;
        }
    }

    let idx = found_index
        .ok_or_else(|| anyhow!("could not find avifenc inside downloaded libavif artifacts"))?;

    let mut file = archive
        .by_index(idx)
        .with_context(|| format!("failed to open avifenc zip entry {idx} for extraction"))?;

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    {
        let mut out = fs::File::create(dest)
            .with_context(|| format!("failed to create {}", dest.display()))?;
        std::io::copy(&mut file, &mut out)
            .with_context(|| format!("failed to extract {}", dest.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest)
            .with_context(|| format!("failed to read metadata for {}", dest.display()))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms)
            .with_context(|| format!("failed to mark {} as executable", dest.display()))?;
    }

    Ok(())
}
