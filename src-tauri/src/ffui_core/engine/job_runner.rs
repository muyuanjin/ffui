use std::collections::hash_map::DefaultHasher;
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use super::ffmpeg_args::{
    apply_audio_args, apply_audio_filter_args, apply_container_args,
    apply_mapping_disposition_and_metadata_args, assign_child_to_job, build_ffmpeg_args,
    compute_progress_percent, configure_background_command,
    detect_best_effort_video_start_time_seconds, detect_duration_seconds, detect_video_codec,
    detect_video_dimensions_and_frame_rate, detect_video_stream_duration_seconds,
    format_command_for_log, infer_output_extension, is_ffmpeg_progress_end,
    parse_ffmpeg_duration_from_metadata_line, parse_ffmpeg_progress_line,
    parse_ffmpeg_progress_sample,
};
use super::state::{
    Inner, notify_queue_listeners, register_known_batch_compress_output_with_inner,
};
use crate::ffui_core::domain::{JobStatus, JobType, MediaInfo, WaitMetadata};
use crate::ffui_core::settings::{DownloadedToolInfo, DownloadedToolState};
use crate::ffui_core::tools::{
    ExternalToolKind, ensure_tool_available, last_tool_download_metadata,
};
use crate::sync_ext::MutexExt;

// Implementation is split across smaller include files to keep each source file
// under the 500-line limit while preserving the original module API.
include!("job_runner_time_and_batch_compress.rs");
include!("job_runner_state.rs");
include!("job_runner_progress.rs");
include!("job_runner_paths_and_preview.rs");
include!("job_runner_preview_thumbnails.rs");
include!("job_runner_media_and_logging.rs");
// 将包含测试子模块的 job_runner_process 放在最后，避免 clippy::items_after_test_module
// 警告，同时保持原有 API 和行为不变。
include!("job_runner_process.rs");
