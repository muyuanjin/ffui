#[cfg(test)]
use std::sync::Mutex;

use anyhow::Result;

use super::io::{read_json_file, write_json_file};
use super::preset_templates::{base_preset, filters_empty, filters_scale, video_x264_crf};
use crate::ffui_core::data_root::presets_path;
use crate::ffui_core::domain::FFmpegPreset;
#[cfg(test)]
use crate::sync_ext::MutexExt;

// Many unit tests (and some integration-style tests) touch the same
// shared presets file path. Guard this path under `cfg(test)` so
// unrelated tests cannot race and accidentally overwrite or observe a
// partially-updated file.
#[cfg(test)]
static PRESETS_SIDECAR_MUTEX: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(super) fn with_presets_sidecar_lock<T>(f: impl FnOnce() -> T) -> T {
    use std::cell::Cell;

    thread_local! {
        static HELD: Cell<bool> = const { Cell::new(false) };
    }

    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            HELD.with(|flag| flag.set(false));
        }
    }

    // Allow re-entrancy within the same thread so tests can compose
    // `with_presets_sidecar_lock` with `load_presets`/`save_presets` without
    // deadlocking on the non-reentrant std::sync::Mutex.
    if HELD.with(Cell::get) {
        return f();
    }

    let _guard = PRESETS_SIDECAR_MUTEX.lock_unpoisoned();
    HELD.with(|flag| flag.set(true));
    let _reset = Reset;
    f()
}

#[cfg(not(test))]
fn with_presets_sidecar_lock<T>(f: impl FnOnce() -> T) -> T {
    f()
}

/// Build the original pair of x264-based default presets used before the
/// onboarding-driven smart presets were introduced.
///
/// These remain as a compatibility fallback and are injected when no
/// presets sidecar exists and onboarding/smart defaults have not yet been
/// applied. New smart default packs are built on top of a richer recipe
/// library and do not rely on this helper.
pub(super) fn default_presets() -> Vec<FFmpegPreset> {
    vec![
        base_preset(
            "p1",
            "Universal 1080p",
            "x264 Medium CRF 23. Standard for web.",
            video_x264_crf(23, "medium", None),
            filters_scale("-2:1080"),
            None,
        ),
        base_preset(
            "p2",
            "Archive Master",
            "x264 Slow CRF 18. Near lossless.",
            video_x264_crf(18, "slow", None),
            filters_empty(),
            None,
        ),
    ]
}

pub fn load_presets() -> Result<Vec<FFmpegPreset>> {
    with_presets_sidecar_lock(|| {
        let path = presets_path()?;
        // When there is no presets.json yet (fresh install), or when the file is
        // unreadable/empty, fall back to the built-in defaults so well-known
        // presets like "Universal 1080p" (id p1) are always present for the
        // transcoding engine. Otherwise, respect exactly what the user saved
        // (including intentional removal of built-in presets).
        let presets: Vec<FFmpegPreset> = if path.exists() {
            match read_json_file::<Vec<FFmpegPreset>>(&path) {
                Ok(existing) if !existing.is_empty() => existing,
                Ok(_) => default_presets(),
                Err(err) => {
                    crate::debug_eprintln!(
                        "failed to load presets from {}: {err:#}",
                        path.display()
                    );
                    default_presets()
                }
            }
        } else {
            default_presets()
        };

        Ok(presets)
    })
}

pub fn save_presets(presets: &[FFmpegPreset]) -> Result<()> {
    with_presets_sidecar_lock(|| {
        let path = presets_path()?;
        write_json_file(&path, presets)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_presets_start_with_zero_stats() {
        let presets = default_presets();
        assert!(!presets.is_empty(), "default_presets should not be empty");
        for preset in presets {
            assert_eq!(preset.stats.usage_count, 0);
            assert!(preset.stats.total_input_size_mb.abs() < f64::EPSILON);
            assert!(preset.stats.total_output_size_mb.abs() < f64::EPSILON);
            assert!(preset.stats.total_time_seconds.abs() < f64::EPSILON);
        }
    }
}
