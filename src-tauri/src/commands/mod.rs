//! Tauri command handlers organized by functional domain.
//!
//! This module organizes all Tauri commands into logical sub-modules:
//! - `queue`: Queue management operations
//! - `presets`: FFmpeg preset management
//! - `settings`: App settings and smart scan configuration
//! - `tools`: System monitoring and tool management

pub mod presets;
pub mod queue;
pub mod settings;
pub mod tools;
pub mod updater;
