use super::ffmpeg_args::*;
use super::job_runner::*;
use super::smart_scan::*;
use super::state::*;
use super::worker::*;
use super::*;
use crate::ffui_core::ImageTargetFormat;
use crate::ffui_core::JobStatus;
use crate::ffui_core::domain::{
    AudioCodecType, AudioConfig, ContainerConfig, DurationMode, EncoderType, FilterConfig,
    GlobalConfig, HardwareConfig, InputTimelineConfig, MappingConfig, MediaInfo, OverwriteBehavior,
    PresetStats, RateControlMode, SeekMode, SubtitleStrategy, SubtitlesConfig, VideoConfig,
};
use crate::ffui_core::settings::AppSettings;
use std::env;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc as TestArc, Mutex as TestMutex};

mod common;

use common::*;

mod crash_recovery_merge_tests;
mod enqueue_and_logging;
mod ffmpeg_args_contract_tests;
mod ffmpeg_args_tests;
mod ffmpeg_integration;
mod image_and_preview;
mod job_progress_and_processing;
mod job_progress_wall_clock;
mod job_wait_wall_clock;
mod listeners_and_queue_state;
mod progress_parsing_and_utils;
mod queue_basic;
mod queue_delete;
mod queue_recovery_tests;
mod queue_wait_and_restart;
mod smart_scan_audio_tests;
mod smart_scan_delete_no_children;
mod smart_scan_enqueue_tests;
mod smart_scan_name_tests;
mod smart_scan_tests;
mod tools_download_metadata;
mod transcode_activity_tests;
