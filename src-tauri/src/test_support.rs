use std::ffi::{OsStr, OsString};
use std::sync::{Mutex, MutexGuard};

use once_cell::sync::Lazy;

use crate::sync_ext::MutexExt;

static ENV_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[must_use]
pub fn make_transcode_job_for_tests(
    id: &str,
    status: crate::ffui_core::JobStatus,
    progress: f64,
    start_time: Option<u64>,
) -> crate::ffui_core::TranscodeJob {
    use crate::ffui_core::{JobLogLine, JobSource, JobType, TranscodeJob};

    /* jscpd:ignore-start */
    TranscodeJob {
        id: id.to_string(),
        filename: format!("{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: None,
        preset_id: "preset-1".to_string(),
        status,
        progress,
        start_time,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::<JobLogLine>::new(),
        log_head: None,
        skip_reason: None,
        input_path: None,
        created_time_ms: None,
        modified_time_ms: None,
        output_path: None,
        output_policy: None,
        ffmpeg_command: None,
        runs: Vec::new(),
        media_info: None,
        estimated_seconds: None,
        preview_path: None,
        preview_revision: 0,
        log_tail: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: None,
        wait_metadata: None,
    }
    /* jscpd:ignore-end */
}

#[must_use]
pub fn make_ffmpeg_preset_for_tests(id: &str) -> crate::ffui_core::FFmpegPreset {
    use crate::ffui_core::{
        AudioCodecType, AudioConfig, EncoderType, FFmpegPreset, FilterConfig, PresetStats,
        RateControlMode, VideoConfig,
    };

    /* jscpd:ignore-start */
    FFmpegPreset {
        id: id.to_string(),
        name: "Test Preset".to_string(),
        description: "Preset used for unit tests".to_string(),
        created_time_ms: None,
        description_i18n: None,
        global: None,
        input: None,
        mapping: None,
        video: VideoConfig {
            encoder: EncoderType::Libx264,
            rate_control: RateControlMode::Crf,
            quality_value: 23,
            preset: "medium".to_string(),
            tune: None,
            profile: None,
            bitrate_kbps: None,
            max_bitrate_kbps: None,
            buffer_size_kbits: None,
            pass: None,
            level: None,
            gop_size: None,
            bf: None,
            pix_fmt: None,
            b_ref_mode: None,
            rc_lookahead: None,
            spatial_aq: None,
            temporal_aq: None,
        },
        audio: AudioConfig {
            codec: AudioCodecType::Copy,
            bitrate: None,
            sample_rate_hz: None,
            channels: None,
            channel_layout: None,
            loudness_profile: None,
            target_lufs: None,
            loudness_range: None,
            true_peak_db: None,
        },
        filters: FilterConfig {
            scale: None,
            crop: None,
            fps: None,
            vf_chain: None,
            af_chain: None,
            filter_complex: None,
        },
        subtitles: None,
        container: None,
        hardware: None,
        stats: PresetStats {
            usage_count: 0,
            total_input_size_mb: 0.0,
            total_output_size_mb: 0.0,
            total_time_seconds: 0.0,
            total_frames: 0.0,
            vmaf_count: 0,
            vmaf_sum: 0.0,
            vmaf_min: 0.0,
            vmaf_max: 0.0,
        },
        advanced_enabled: Some(false),
        ffmpeg_template: None,
        is_smart_preset: None,
    }
    /* jscpd:ignore-end */
}

pub fn env_lock() -> MutexGuard<'static, ()> {
    ENV_MUTEX.lock_unpoisoned()
}

pub fn set_env<K: AsRef<OsStr>, V: AsRef<OsStr>>(key: K, value: V) {
    unsafe { std::env::set_var(key, value) }
}

pub fn remove_env<K: AsRef<OsStr>>(key: K) {
    unsafe { std::env::remove_var(key) }
}

pub struct EnvVarGuard {
    prev: Vec<(String, Option<OsString>)>,
}

impl EnvVarGuard {
    pub fn capture<I, S>(keys: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let prev = keys
            .into_iter()
            .map(|k| {
                let key = k.as_ref().to_string();
                let value = std::env::var_os(&key);
                (key, value)
            })
            .collect();

        Self { prev }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        for (key, value) in self.prev.drain(..) {
            match value {
                Some(v) => set_env(&key, v),
                None => remove_env(&key),
            }
        }
    }
}
