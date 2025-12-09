mod candidates;
mod discover;
mod download;
mod probe;
mod resolve;
mod runtime_state;
mod status;
#[cfg(test)]
mod tests_manager;
#[cfg(test)]
mod tests_probe;
#[cfg(test)]
mod tests_runtime;
#[cfg(test)]
mod tests_runtime_clear_error;
mod types;

// Re-export API
pub(crate) use candidates::tool_candidates;
pub(crate) use download::{ensure_tool_available, force_download_tool_binary};
pub(crate) use probe::verify_tool_binary;
pub(crate) use runtime_state::{
    clear_tool_runtime_error, hydrate_last_tool_download_from_settings,
    last_tool_download_metadata, set_app_handle as set_tool_event_app_handle,
    update_latest_status_snapshot,
};
pub(crate) use status::tool_status;
pub use types::{ExternalToolCandidate, ExternalToolKind, ExternalToolStatus};
