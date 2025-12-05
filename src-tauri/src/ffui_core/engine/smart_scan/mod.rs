//! Smart Scan functionality for automatic media compression.
//!
//! This module handles the intelligent scanning of directories for media files
//! (images and videos) that are candidates for compression, applying filters
//! based on size, codec, and savings ratio.

mod detection;
mod helpers;
mod image;
mod orchestrator;
mod video;
mod video_paths;

pub(super) use detection::{
    build_image_avif_paths, is_image_file, is_smart_scan_style_output, is_video_file,
};
pub(super) use helpers::{
    current_time_millis, next_job_id, notify_queue_listeners, record_tool_download,
};
pub(super) use image::handle_image_file;
pub(super) use orchestrator::{run_auto_compress, smart_scan_batch_summary};
pub(super) use video::handle_video_file;
pub(super) use video_paths::reserve_unique_smart_scan_video_output_path;
