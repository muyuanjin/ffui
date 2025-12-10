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

mod enqueue_and_logging;
mod ffmpeg_args_contract_tests;
mod ffmpeg_args_tests;
mod ffmpeg_integration;
mod image_and_preview;
mod job_progress_and_processing;
mod listeners_and_queue_state;
mod progress_parsing_and_utils;
mod queue_basic;
mod queue_delete;
mod queue_wait_and_restart;
mod smart_scan_audio_tests;
mod smart_scan_name_tests;
mod smart_scan_tests;
mod tools_download_metadata;
