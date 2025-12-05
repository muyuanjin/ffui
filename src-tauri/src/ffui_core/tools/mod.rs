mod download;
mod probe;
mod resolve;
mod runtime_state;
#[cfg(test)]
mod tests;
mod types;

// Re-export API
pub(crate) use download::ensure_tool_available;
pub(crate) use probe::tool_status;
pub(crate) use runtime_state::last_tool_download_metadata;
pub use types::{ExternalToolKind, ExternalToolStatus};
