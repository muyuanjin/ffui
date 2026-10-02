use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail};

fn header(file: &mut File, end: u64) -> Result<Option<([u8; 4], u64)>> {
    let position = file.stream_position()?;
    if position == end {
        return Ok(None);
    }
    if end.saturating_sub(position) < 8 {
        return Ok(None);
    }
    let mut bytes = [0_u8; 8];
    file.read_exact(&mut bytes)?;
    let mut size = u64::from(u32::from_be_bytes(bytes[..4].try_into()?));
    let mut header_size = 8;
    if size == 1 {
        if end - position < 16 {
            return Ok(None);
        }
        file.read_exact(&mut bytes)?;
        size = u64::from_be_bytes(bytes);
        header_size = 16;
    } else if size == 0 {
        size = end - position;
    }
    if size < header_size || size > end - position {
        return Ok(None);
    }
    let mut kind = [0_u8; 4];
    file.seek(SeekFrom::Start(position + 4))?;
    file.read_exact(&mut kind)?;
    file.seek(SeekFrom::Start(position + header_size))?;
    Ok(Some((kind, position + size)))
}

fn inspect(file: &mut File, end: u64, depth: u8) -> Result<bool> {
    let mut boxes = 0;
    while let Some((kind, box_end)) = header(file, end)? {
        boxes += 1;
        if boxes > 4096 {
            bail!("image container metadata exceeds inspection limits");
        }
        match &kind {
            b"meta" if depth == 0 => {
                let position = file.stream_position()?;
                if box_end.saturating_sub(position) < 4 {
                    bail!("invalid image container metadata");
                }
                file.seek(SeekFrom::Current(4))?;
                if inspect(file, box_end, 1)? {
                    return Ok(true);
                }
            }
            b"iprp" if depth == 1 && inspect(file, box_end, 2)? => return Ok(true),
            b"ipco" if depth == 2 && inspect(file, box_end, 3)? => return Ok(true),
            b"auxC" if depth == 3 => {
                let length = box_end - file.stream_position()?;
                if !(5..=4096).contains(&length) {
                    bail!("unsupported image auxiliary metadata");
                }
                let mut bytes = vec![0_u8; usize::try_from(length)?];
                file.read_exact(&mut bytes)?;
                let auxiliary = bytes[4..]
                    .split(|value| *value == 0)
                    .next()
                    .unwrap_or_default();
                if auxiliary == b"urn:mpeg:mpegB:cicp:systems:auxiliary:alpha"
                    || auxiliary == b"urn:mpeg:hevc:2015:auxid:1"
                {
                    return Ok(true);
                }
            }
            _ => {}
        }
        file.seek(SeekFrom::Start(box_end))?;
    }
    if file.stream_position()? != end {
        bail!("invalid image container box layout");
    }
    Ok(false)
}

fn has_file_type(file: &mut File, size: u64) -> Result<bool> {
    for _ in 0..4096 {
        let Some((kind, box_end)) = header(file, size)? else {
            return Ok(false);
        };
        if &kind == b"ftyp" {
            return Ok(true);
        }
        file.seek(SeekFrom::Start(box_end))?;
    }
    bail!("image container exceeds top-level inspection limits");
}

pub(super) fn validate(source: &Path, ffmpeg: &Path) -> Result<()> {
    let mut file = File::open(source)?;
    let size = file.metadata()?.len();
    if !has_file_type(&mut file, size)? {
        return Ok(());
    }
    file.seek(SeekFrom::Start(0))?;
    if !inspect(&mut file, size, 0).context("image transparency inspection failed")? {
        return Ok(());
    }
    let output = super::run_preview_command(
        Command::new(ffmpeg)
            .args([
                "-nostdin",
                "-v",
                "error",
                "-noauto_conversion_filters",
                "-filter_threads",
                "1",
                "-i",
            ])
            .arg(source)
            .args([
                "-map",
                "0:v:0",
                "-vf",
                "alphaextract",
                "-frames:v",
                "1",
                "-f",
                "null",
                "-",
            ]),
        Duration::from_secs(20),
    )?;
    if !output.status.success() {
        bail!(
            "compatible preview decoder cannot preserve auxiliary AVIF/HEIF transparency; open the original in a system application: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}
