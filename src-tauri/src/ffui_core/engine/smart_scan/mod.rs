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

#[cfg(test)]
pub(super) use detection::{build_image_avif_paths, is_smart_scan_style_output};
#[cfg(test)]
pub(super) use image::handle_image_file;
pub(super) use orchestrator::run_auto_compress;
#[cfg(test)]
pub(super) use orchestrator::smart_scan_batch_summary;
#[cfg(test)]
pub(super) use video_paths::reserve_unique_smart_scan_video_output_path;
