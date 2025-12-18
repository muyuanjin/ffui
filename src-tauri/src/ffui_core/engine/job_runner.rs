use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{
    Hash,
    Hasher,
};
use std::io::{
    BufRead,
    BufReader,
};
use std::path::{
    Path,
    PathBuf,
};
use std::process::{
    Command,
    Stdio,
};
use std::time::{
    Duration,
    SystemTime,
    UNIX_EPOCH,
};

use anyhow::{
    Context,
    Result,
};

use super::ffmpeg_args::*;
use super::state::{
    BatchCompressBatchStatus,
    Inner,
    notify_queue_listeners,
    register_known_batch_compress_output_with_inner,
    update_batch_compress_batch_with_inner,
};
use crate::ffui_core::domain::{
    JobStatus,
    JobType,
    MediaInfo,
    WaitMetadata,
};
use crate::ffui_core::settings::{
    DEFAULT_PROGRESS_UPDATE_INTERVAL_MS,
    DownloadedToolInfo,
    DownloadedToolState,
};
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
    last_tool_download_metadata,
};

// Implementation is split across smaller include files to keep each source file
// under the 500-line limit while preserving the original module API.
include!("job_runner_time_and_batch_compress.rs");
include!("job_runner_state.rs");
include!("job_runner_progress.rs");
include!("job_runner_paths_and_preview.rs");
include!("job_runner_media_and_logging.rs");
// 将包含测试子模块的 job_runner_process 放在最后，避免 clippy::items_after_test_module
// 警告，同时保持原有 API 和行为不变。
include!("job_runner_process.rs");
