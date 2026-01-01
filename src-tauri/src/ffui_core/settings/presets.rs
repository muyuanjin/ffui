use std::sync::Mutex;

use anyhow::Result;

use super::io::{read_json_file, write_json_file};
use super::preset_templates::{base_preset, filters_empty, filters_scale, video_x264_crf};
use crate::ffui_core::data_root::presets_path;
use crate::ffui_core::domain::FFmpegPreset;
use crate::sync_ext::MutexExt;

// The presets sidecar uses a fixed `*.tmp` path during atomic writes, so
// concurrent writers can clobber each other's temp file and/or reorder final
// renames. Guard all preset sidecar IO (load/save) with a single process-wide
// mutex to avoid corruption and lost updates when multiple jobs complete in
// parallel.
static PRESETS_SIDECAR_MUTEX: Mutex<()> = Mutex::new(());

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
    let path = presets_path()?;
    #[cfg(test)]
    maybe_block_first_save_presets_for_tests(&path);
    with_presets_sidecar_lock(|| write_json_file(&path, presets))
}

#[cfg(test)]
pub(crate) struct BlockFirstSavePresetsGuard {
    target_path: std::path::PathBuf,
}

#[cfg(test)]
struct SavePresetsGateState {
    active: bool,
    target_path: std::path::PathBuf,
    call_count: usize,
    first_entered: bool,
    allow_first: bool,
}

#[cfg(test)]
struct SavePresetsGate {
    state: std::sync::Mutex<SavePresetsGateState>,
    cv: std::sync::Condvar,
}

#[cfg(test)]
fn save_presets_gate() -> &'static SavePresetsGate {
    use std::sync::OnceLock;
    static GATE: OnceLock<SavePresetsGate> = OnceLock::new();
    GATE.get_or_init(|| SavePresetsGate {
        state: std::sync::Mutex::new(SavePresetsGateState {
            active: false,
            target_path: std::path::PathBuf::new(),
            call_count: 0,
            first_entered: false,
            allow_first: true,
        }),
        cv: std::sync::Condvar::new(),
    })
}

#[cfg(test)]
fn maybe_block_first_save_presets_for_tests(path: &std::path::Path) {
    use std::time::Duration;

    let gate = save_presets_gate();
    let mut guard = gate
        .state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    if !guard.active || guard.target_path != path {
        return;
    }

    let call_index = guard.call_count;
    guard.call_count += 1;
    gate.cv.notify_all();

    if call_index != 0 {
        return;
    }

    guard.first_entered = true;
    gate.cv.notify_all();

    while !guard.allow_first {
        let (next, _timeout) = gate
            .cv
            .wait_timeout(
                guard,
                // Avoid hanging forever if a test crashes mid-flight.
                Duration::from_secs(10),
            )
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard = next;
    }
}

#[cfg(test)]
impl BlockFirstSavePresetsGuard {
    pub(crate) fn new(target_path: std::path::PathBuf) -> Self {
        let gate = save_presets_gate();
        let mut guard = gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard.active = true;
        guard.target_path = target_path.clone();
        guard.call_count = 0;
        guard.first_entered = false;
        guard.allow_first = false;
        gate.cv.notify_all();
        Self { target_path }
    }

    pub(crate) fn wait_first_entered(&self, timeout: std::time::Duration) -> bool {
        let gate = save_presets_gate();
        let mut guard = gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if guard.active && guard.target_path == self.target_path && guard.first_entered {
                return true;
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let (next, _timeout_res) = gate
                .cv
                .wait_timeout(guard, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard = next;
        }
        false
    }

    pub(crate) fn wait_call_count_at_least(&self, n: usize, timeout: std::time::Duration) -> bool {
        let gate = save_presets_gate();
        let mut guard = gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if guard.active && guard.target_path == self.target_path && guard.call_count >= n {
                return true;
            }
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let (next, _timeout_res) = gate
                .cv
                .wait_timeout(guard, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard = next;
        }
        false
    }

    pub(crate) fn unblock_first(&self) {
        let gate = save_presets_gate();
        let mut guard = gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !guard.active || guard.target_path != self.target_path {
            return;
        }
        guard.allow_first = true;
        gate.cv.notify_all();
    }
}

#[cfg(test)]
impl Drop for BlockFirstSavePresetsGuard {
    fn drop(&mut self) {
        let gate = save_presets_gate();
        let mut guard = gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.active && guard.target_path == self.target_path {
            guard.active = false;
            guard.allow_first = true;
            gate.cv.notify_all();
        }
    }
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
