//! Batch Compress functionality for automatic media compression.
//!
//! This module handles the intelligent scanning of directories for media files
//! (images and videos) that are candidates for compression, applying filters
//! based on size, codec, and savings ratio.

mod audio;
mod detection;
mod helpers;
mod image;
mod image_encode_avif;
mod orchestrator;
mod orchestrator_helpers;
#[cfg(not(test))]
mod video;
#[cfg(test)]
pub(crate) mod video;
mod video_helpers;
mod video_paths;

pub(crate) use detection::is_video_file;
#[cfg(test)]
pub(super) use detection::{build_image_avif_paths, is_batch_compress_style_output};
#[cfg(test)]
pub(super) use image::handle_image_file;
pub(super) use orchestrator::run_auto_compress;
#[cfg(test)]
pub(super) use orchestrator_helpers::batch_compress_batch_summary;
#[cfg(test)]
pub(super) use video_paths::reserve_unique_batch_compress_video_output_path;
