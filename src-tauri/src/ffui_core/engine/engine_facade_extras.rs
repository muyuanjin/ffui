use super::{TranscodingEngine, batch_compress, job_runner, transcode_activity};
use crate::ffui_core::domain::{AutoCompressResult, BatchCompressConfig, JobStatus, JobType};
use crate::ffui_core::settings;
use crate::ffui_core::tools::{
    ExternalToolKind, ExternalToolStatus, tool_status, update_probe_cache_from_statuses,
};
use crate::sync_ext::MutexExt;
use anyhow::Result;
use std::path::Path;
use std::time::Duration;
use std::{fs, time::SystemTime};

impl TranscodingEngine {
    fn record_preset_vmaf_measurement(
        &self,
        preset_id: &str,
        mean: f64,
        label: &str,
    ) -> Result<()> {
        let mut state = self.inner.state.lock_unpoisoned();
        let presets = std::sync::Arc::make_mut(&mut state.presets);
        let Some(preset) = presets.iter_mut().find(|p| p.id == preset_id) else {
            anyhow::bail!("preset not found: {preset_id}");
        };
        let c = preset.stats.vmaf_count;
        preset.stats.vmaf_count = c + 1;
        preset.stats.vmaf_sum += mean;
        if c == 0 {
            preset.stats.vmaf_min = mean;
            preset.stats.vmaf_max = mean;
        } else {
            preset.stats.vmaf_min = preset.stats.vmaf_min.min(mean);
            preset.stats.vmaf_max = preset.stats.vmaf_max.max(mean);
        }

        if let Err(err) = crate::ffui_core::settings::save_presets(presets) {
            crate::debug_eprintln!(
                "{label}: failed to persist presets after VMAF measurement: {err:#}"
            );
        }
        Ok(())
    }

    /// Persist metadata for a manually triggered external tool download.
    pub fn record_manual_tool_download(&self, kind: ExternalToolKind, binary_path: &str) {
        job_runner::record_tool_download_with_inner(&self.inner, kind, binary_path);
    }

    /// Get the status of all external tools.
    pub fn external_tool_statuses(&self) -> Vec<ExternalToolStatus> {
        // Snapshot tool settings while holding the engine lock, then perform any
        // filesystem/probing work outside the lock to avoid blocking other
        // startup commands and queue snapshots.
        let tools = {
            let state = self.inner.state.lock_unpoisoned();
            state.settings.tools.clone()
        };
        let statuses = vec![
            tool_status(ExternalToolKind::Ffmpeg, &tools),
            tool_status(ExternalToolKind::Ffprobe, &tools),
            tool_status(ExternalToolKind::Avifenc, &tools),
        ];

        // Cache a snapshot for event-based updates so the tools module can
        // emit ffui://external-tool-status without re-probing the filesystem
        // on every download tick.
        crate::ffui_core::tools::update_latest_status_snapshot(statuses.clone());
        let settings_to_persist = {
            let mut state = self.inner.state.lock_unpoisoned();
            if update_probe_cache_from_statuses(&mut state.settings.tools, &statuses) {
                Some(state.settings.clone())
            } else {
                None
            }
        };
        if let Some(settings_to_persist) = settings_to_persist
            && let Err(err) = settings::save_settings(&settings_to_persist)
        {
            crate::debug_eprintln!("[tools_probe_cache] failed to persist probe cache: {err:#}");
        }
        statuses
    }

    /// Get the Batch Compress default configuration.
    pub fn batch_compress_defaults(&self) -> BatchCompressConfig {
        let state = self.inner.state.lock_unpoisoned();
        state.settings.batch_compress_defaults.clone()
    }

    /// Update the Batch Compress default configuration.
    pub fn update_batch_compress_defaults(
        &self,
        config: BatchCompressConfig,
    ) -> Result<BatchCompressConfig> {
        let settings_snapshot = {
            let mut state = self.inner.state.lock_unpoisoned();
            state.settings.batch_compress_defaults = config.clone();
            state.settings.clone()
        };
        settings::save_settings(&settings_snapshot)?;
        Ok(config)
    }

    /// Run Batch Compress auto-compress on a directory.
    pub fn run_auto_compress(
        &self,
        root_path: String,
        config: BatchCompressConfig,
    ) -> Result<AutoCompressResult> {
        batch_compress::run_auto_compress(&self.inner, root_path, config)
    }

    /// Get the summary of a Batch Compress batch.
    #[cfg(test)]
    pub fn batch_compress_batch_summary(&self, batch_id: &str) -> Option<AutoCompressResult> {
        batch_compress::batch_compress_batch_summary(&self.inner, batch_id)
    }

    /// Inspect media file metadata using ffprobe.
    pub fn inspect_media(&self, path: &str) -> Result<String> {
        job_runner::inspect_media(&self.inner, path)
    }

    /// Compute VMAF mean for a completed job (input vs output), then aggregate the
    /// result into the preset's persisted stats.
    pub fn measure_job_vmaf(&self, job_id: &str, trim_seconds: Option<f64>) -> Result<f64> {
        // Snapshot job paths + preset id outside the expensive ffmpeg run.
        let (preset_id, input_path, output_path, tools) = {
            let state = self.inner.state.lock_unpoisoned();
            let Some(job) = state.jobs.get(job_id) else {
                anyhow::bail!("job not found: {job_id}");
            };
            if job.job_type != JobType::Video {
                anyhow::bail!("job is not a video job");
            }
            if job.status != JobStatus::Completed {
                anyhow::bail!("job is not completed");
            }
            let preset_id = job.preset_id.clone();
            let input_path = job
                .input_path
                .clone()
                .unwrap_or_else(|| job.filename.clone());
            let output_path = job
                .output_path
                .clone()
                .ok_or_else(|| anyhow::anyhow!("output path is not available yet"))?;
            (
                preset_id,
                input_path,
                output_path,
                state.settings.tools.clone(),
            )
        };

        let (ffmpeg_path, _source) =
            crate::ffui_core::tools::resolve_tool_path(ExternalToolKind::Ffmpeg, &tools)
                .unwrap_or_else(|_| ("ffmpeg".to_string(), "path".to_string()));

        let mean = super::vmaf::measure_vmaf_mean_with_ffmpeg(
            &ffmpeg_path,
            Path::new(&input_path),
            Path::new(&output_path),
            super::vmaf::VmafMeasureOptions {
                trim_seconds,
                timeout: Duration::from_secs(60 * 30),
            },
        )?;

        self.record_preset_vmaf_measurement(&preset_id, mean, "measure_job_vmaf")?;

        Ok(mean)
    }

    /// Encode the given reference video with a preset, then measure VMAF mean
    /// (reference vs encoded output) and aggregate into the preset's stats.
    ///
    /// This is intended for manual calibration and "anchor video" workflows.
    pub fn measure_preset_vmaf(
        &self,
        preset_id: &str,
        reference_path: &str,
        trim_seconds: Option<f64>,
    ) -> Result<f64> {
        let reference_path = Path::new(reference_path);
        if !reference_path.is_file() {
            anyhow::bail!(
                "reference video does not exist: {}",
                reference_path.display()
            );
        }

        let (preset, tools) = {
            let state = self.inner.state.lock_unpoisoned();
            let presets = state.presets.as_ref();
            let Some(preset) = presets.iter().find(|p| p.id == preset_id) else {
                anyhow::bail!("preset not found: {preset_id}");
            };
            (preset.clone(), state.settings.tools.clone())
        };

        let (ffmpeg_path, _source) =
            crate::ffui_core::tools::resolve_tool_path(ExternalToolKind::Ffmpeg, &tools)
                .unwrap_or_else(|_| ("ffmpeg".to_string(), "path".to_string()));

        let sanitize_id = |raw: &str| -> String {
            raw.chars()
                .map(|c| match c {
                    'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => c,
                    _ => '_',
                })
                .collect()
        };

        let data_root = crate::ffui_core::data_root::data_root_dir()?;
        let out_dir = data_root
            .join("vmaf")
            .join("runs")
            .join(sanitize_id(&preset.id));
        fs::create_dir_all(&out_dir)?;

        let now_ms = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let output_path = out_dir.join(format!(
            "preset_vmaf_{now_ms}_{}.mp4",
            sanitize_id(
                reference_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("ref")
            )
        ));

        let mut args = super::build_ffmpeg_args(&preset, reference_path, &output_path, true, None);

        if let Some(t) = trim_seconds
            && t.is_finite()
            && t > 0.0
            && !args.iter().any(|a| a == "-t" || a == "-to")
            && !args.is_empty()
        {
            // `build_ffmpeg_args` always places OUTPUT as the last argument.
            let insert_at = args.len().saturating_sub(1);
            args.insert(insert_at, "-t".to_string());
            args.insert(insert_at + 1, t.to_string());
        }

        // Pre-flight: ensure ffmpeg can both encode with the preset encoder and compute VMAF.
        //
        // This avoids a long-running encode attempt that fails late with confusing stderr
        // when the bundled/custom ffmpeg is missing encoders (e.g. libsvtav1) or libvmaf.
        crate::ffui_core::tools::ensure_ffmpeg_filter_help_available(&ffmpeg_path, "libvmaf")
            .map_err(|err| {
                anyhow::anyhow!(
                    "ffmpeg does not provide the libvmaf filter (required for VMAF measurement); ffmpeg={ffmpeg_path}: {err:#}"
                )
            })?;
        if let Some(idx) = args.iter().position(|a| a == "-c:v")
            && let Some(enc) = args.get(idx + 1).map(String::as_str)
            && enc != "copy"
        {
            crate::ffui_core::tools::ensure_ffmpeg_video_encoder_usable(&ffmpeg_path, enc).map_err(|err| {
                anyhow::anyhow!(
                    "ffmpeg cannot use video encoder '{enc}' (required by preset '{preset_id}'); ffmpeg={ffmpeg_path}: {err:#}"
                )
            })?;
        }

        {
            let mut cmd = std::process::Command::new(&ffmpeg_path);
            cmd.args(&args);
            super::configure_background_command(&mut cmd);
            let (status, timed_out, stderr_bytes) =
                crate::process_ext::run_command_with_timeout_capture_stderr(
                    cmd,
                    Duration::from_secs(60 * 30),
                    4 * 1024 * 1024,
                )?;
            if timed_out {
                anyhow::bail!("ffmpeg timed out while encoding the VMAF sample");
            }
            if !status.success() {
                let stderr_text = String::from_utf8_lossy(&stderr_bytes);
                anyhow::bail!(
                    "ffmpeg exited with non-zero status while encoding the VMAF sample: {}",
                    stderr_text
                        .lines()
                        .rev()
                        .take(12)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n")
                );
            }
        }

        let mean = super::vmaf::measure_vmaf_mean_with_ffmpeg(
            &ffmpeg_path,
            reference_path,
            &output_path,
            super::vmaf::VmafMeasureOptions {
                trim_seconds,
                timeout: Duration::from_secs(60 * 30),
            },
        )?;

        self.record_preset_vmaf_measurement(preset_id, mean, "measure_preset_vmaf")?;

        Ok(mean)
    }

    /// Return today's transcode activity buckets for the Monitor heatmap.
    pub fn transcode_activity_today(&self) -> crate::ffui_core::TranscodeActivityToday {
        transcode_activity::get_transcode_activity_today(&self.inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_ext::MutexExt;

    #[test]
    fn measure_job_vmaf_errors_when_job_is_missing() {
        let engine = TranscodingEngine::new_for_tests();
        let err = engine
            .measure_job_vmaf("missing-job", Some(10.0))
            .expect_err("expected error");
        let msg = format!("{err:#}");
        assert!(msg.contains("job not found"));
    }

    #[test]
    fn measure_job_vmaf_errors_when_job_not_completed() {
        let engine = TranscodingEngine::new_for_tests();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            let job = crate::test_support::make_transcode_job_for_tests(
                "job-1",
                JobStatus::Queued,
                0.0,
                None,
            );
            state.jobs.insert("job-1".to_string(), job);
        }

        let err = engine
            .measure_job_vmaf("job-1", Some(10.0))
            .expect_err("expected error");
        let msg = format!("{err:#}");
        assert!(msg.contains("job is not completed"));
    }

    #[test]
    fn measure_job_vmaf_errors_when_job_not_video() {
        let engine = TranscodingEngine::new_for_tests();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            let mut job = crate::test_support::make_transcode_job_for_tests(
                "job-1",
                JobStatus::Completed,
                1.0,
                None,
            );
            job.job_type = JobType::Image;
            job.output_path = Some("C:/output.png".to_string());
            state.jobs.insert("job-1".to_string(), job);
        }

        let err = engine
            .measure_job_vmaf("job-1", Some(10.0))
            .expect_err("expected error");
        let msg = format!("{err:#}");
        assert!(msg.contains("job is not a video job"));
    }

    #[test]
    fn measure_job_vmaf_errors_when_output_path_unavailable() {
        let engine = TranscodingEngine::new_for_tests();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            let mut job = crate::test_support::make_transcode_job_for_tests(
                "job-1",
                JobStatus::Completed,
                1.0,
                None,
            );
            job.input_path = Some("C:/input.mp4".to_string());
            job.output_path = None;
            state.jobs.insert("job-1".to_string(), job);
        }

        let err = engine
            .measure_job_vmaf("job-1", Some(10.0))
            .expect_err("expected error");
        let msg = format!("{err:#}");
        assert!(msg.contains("output path is not available yet"));
    }

    #[test]
    fn measure_preset_vmaf_errors_when_preset_missing() {
        let engine = TranscodingEngine::new_for_tests();
        let tmp = tempfile::NamedTempFile::new().expect("tmp ref");
        let ref_path = tmp.path().to_string_lossy().into_owned();
        let err = engine
            .measure_preset_vmaf("missing-preset", &ref_path, Some(10.0))
            .expect_err("expected error");
        let msg = format!("{err:#}");
        assert!(msg.contains("preset not found"));
    }
}
