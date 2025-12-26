//! Tauri command handlers organized by functional domain.
//!
//! This module organizes all Tauri commands into logical sub-modules:
//! - `queue`: Queue management operations
//! - `presets`: `FFmpeg` preset management
//! - `settings`: App settings and batch compress configuration
//! - `tools`: System monitoring and tool management

#[allow(clippy::needless_pass_by_value)]
pub mod app_exit;
#[allow(clippy::needless_pass_by_value)]
pub mod data_root;
#[allow(clippy::needless_pass_by_value)]
pub mod job_compare;
#[allow(clippy::needless_pass_by_value)]
pub mod output;
#[allow(clippy::needless_pass_by_value)]
pub mod presets;
#[allow(clippy::needless_pass_by_value)]
pub mod queue;
#[allow(clippy::needless_pass_by_value)]
pub mod settings;
#[allow(clippy::needless_pass_by_value)]
pub mod tools;
#[allow(clippy::needless_pass_by_value)]
pub mod ui_fonts;
#[allow(clippy::needless_pass_by_value)]
pub mod updater;

pub(crate) fn wait_for_queue_recovery(engine: &crate::ffui_core::TranscodingEngine) {
    use std::sync::atomic::Ordering;

    use crate::sync_ext::{CondvarExt, MutexExt};

    if engine.inner.queue_recovery_done.load(Ordering::Acquire) {
        return;
    }

    let guard = engine.inner.state.lock_unpoisoned();
    let _guard = engine.inner.cv.wait_while_unpoisoned(guard, |_| {
        !engine.inner.queue_recovery_done.load(Ordering::Acquire)
    });
}
