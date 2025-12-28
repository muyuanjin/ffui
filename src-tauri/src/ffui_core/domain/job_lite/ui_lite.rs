//! Compatibility shim for UI-lite queue types.
//!
//! The canonical definitions live in `crate::ffui_core::domain` and are re-exported here to keep
//! historical module paths stable.

pub use crate::ffui_core::domain::{QueueStateUiLite, TranscodeJobUiLite, WaitMetadataUiLite};

