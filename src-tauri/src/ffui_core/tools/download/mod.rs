mod extract;
pub(super) mod manager;
mod net;
mod release;
#[cfg(not(test))]
mod release_http;
mod release_resolver;
#[cfg(test)]
#[path = "release_resolver_tests.rs"]
mod tools_tests_release_resolver;
mod transaction;

pub(crate) use manager::{ensure_tool_available, force_download_tool_binary};
pub(super) use release::{
    try_refresh_ffmpeg_release_from_github, try_refresh_libavif_release_from_github,
};
pub(crate) use release_resolver::ReleaseResolveInfo;

#[cfg(test)]
mod tests_manager_transaction;

#[cfg(not(test))]
pub(super) use release::{
    refresh_ffmpeg_release_from_github_checked, refresh_libavif_release_from_github_checked,
};
