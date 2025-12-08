// IO utilities for reading and writing configuration files
pub(super) mod io;

// Settings type definitions
pub mod types;
pub use types::{DEFAULT_METRICS_INTERVAL_MS, DEFAULT_PROGRESS_UPDATE_INTERVAL_MS};

// FFmpeg preset management
pub mod presets;
pub mod smart_presets;
mod smart_presets_cpu;

// Application settings management
pub mod app_settings;

// Tests
#[cfg(test)]
mod tests;

// Re-export types and main API
pub use app_settings::{load_settings, save_settings};
pub use presets::{load_presets, save_presets};
pub use smart_presets::hardware_smart_default_presets;
pub use types::{
    AppSettings, DownloadedToolInfo, DownloadedToolState, ExternalToolSettings, TaskbarProgressMode,
};
