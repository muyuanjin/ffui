mod builder;
mod builder_tail;
mod builder_webm;
mod container;
mod detect;
mod job_object;
mod output_policy;
mod platform;
mod progress;
mod utils;

// Internal helpers that are safe and useful across engine sub-modules (enqueue,
// Smart Scan queueing, etc).
pub(crate) use builder::build_ffmpeg_args;
pub(super) use container::{
    infer_output_extension,
    normalize_container_format,
};
#[cfg(test)]
pub(super) use detect::parse_ffprobe_frame_rate;
pub(super) use detect::{
    detect_duration_seconds,
    detect_video_codec,
    detect_video_dimensions_and_frame_rate,
};
pub use job_object::{
    assign_child_to_job,
    init_child_process_job,
};
pub(super) use platform::configure_background_command;
#[cfg(test)]
pub(super) use progress::parse_ffmpeg_time_to_seconds;
pub(super) use progress::{
    compute_progress_percent,
    is_ffmpeg_progress_end,
    parse_ffmpeg_duration_from_metadata_line,
    parse_ffmpeg_progress_line,
};
pub(crate) use utils::format_command_for_log;
