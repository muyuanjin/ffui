mod builder;
mod detect;
mod platform;
mod progress;

pub(super) use builder::{build_ffmpeg_args, format_command_for_log};
#[cfg(test)]
pub(super) use detect::parse_ffprobe_frame_rate;
pub(super) use detect::{
    detect_duration_seconds, detect_video_codec, detect_video_dimensions_and_frame_rate,
};
pub(super) use platform::configure_background_command;
#[cfg(test)]
pub(super) use progress::parse_ffmpeg_time_to_seconds;
pub(super) use progress::{
    compute_progress_percent, is_ffmpeg_progress_end, parse_ffmpeg_duration_from_metadata_line,
    parse_ffmpeg_progress_line,
};
