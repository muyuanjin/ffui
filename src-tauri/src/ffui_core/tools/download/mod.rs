mod extract;
pub(super) mod manager;
mod net;
mod release;

pub(crate) use manager::{ensure_tool_available, force_download_tool_binary};
pub(super) use release::{
    try_refresh_ffmpeg_release_from_github, try_refresh_libavif_release_from_github,
};

#[cfg(not(test))]
pub(super) use release::{
    refresh_ffmpeg_release_from_github_checked, refresh_libavif_release_from_github_checked,
};
