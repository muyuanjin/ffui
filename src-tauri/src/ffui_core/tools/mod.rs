mod download;
mod probe;
mod resolve;
mod runtime_state;
#[cfg(test)]
mod tests_probe;
#[cfg(test)]
mod tests_runtime;
mod types;

// Re-export API
pub(crate) use download::{ensure_tool_available, force_download_tool_binary};
pub(crate) use probe::{tool_candidates, tool_status, verify_tool_binary};
pub(crate) use runtime_state::{
    last_tool_download_metadata, set_app_handle as set_tool_event_app_handle,
    update_latest_status_snapshot,
};
pub use types::{ExternalToolCandidate, ExternalToolKind, ExternalToolStatus};
