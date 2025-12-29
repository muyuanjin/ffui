use super::state::notify_queue_lite_delta_listeners;
use super::{TranscodingEngine, job_runner};
use crate::ffui_core::domain::{JobType, MediaInfo};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{ExternalToolKind, ensure_tool_available};
use crate::ffui_core::{
    QueueStateLiteDelta, TranscodeJobLiteDeltaPatch, TranscodeJobLitePreviewDelta,
};
use crate::sync_ext::MutexExt;

impl TranscodingEngine {
    fn resolve_job_source_path(input_path: Option<String>, filename: &str) -> Option<String> {
        let from_input = input_path.and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });
        if from_input.is_some() {
            return from_input;
        }

        let trimmed = filename.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Avoid treating a bare filename as a relative path, which could point to an unrelated file depending on the process working directory.
        let looks_like_path =
            trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains(':');
        if !looks_like_path {
            return None;
        }

        Some(trimmed.to_string())
    }

    fn resolve_duration_seconds_and_update_media_info(
        &self,
        job_id: &str,
        duration_seconds: Option<f64>,
        source_path: &str,
        tools: &ExternalToolSettings,
    ) -> Option<f64> {
        use std::path::Path;

        let duration_seconds = duration_seconds.or_else(|| {
            crate::ffui_core::probe_video_duration_seconds_best_effort(
                Path::new(source_path),
                tools,
            )
            .ok()
        });

        if duration_seconds.is_some() {
            let mut state = self.inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(job_id)
                && job.job_type == JobType::Video
            {
                match job.media_info.as_mut() {
                    Some(info) if info.duration_seconds.is_none() => {
                        info.duration_seconds = duration_seconds;
                    }
                    None => {
                        job.media_info = Some(MediaInfo {
                            duration_seconds,
                            width: None,
                            height: None,
                            frame_rate: None,
                            video_codec: None,
                            audio_codec: None,
                            size_mb: None,
                        });
                    }
                    _ => {}
                }
            }
        }

        duration_seconds
    }

    /// Ensure a video job has a readable preview image on disk.
    ///
    /// If the preview image is missing or unreadable, regenerate it using the latest `preview_capture_percent` setting.
    /// Updates `preview_path`, then broadcasts a queue snapshot so the UI refreshes.
    ///
    /// Returns the resolved preview path when available, otherwise None.
    pub fn ensure_job_preview(&self, job_id: &str) -> Option<String> {
        use std::path::Path;

        let (job_type, input_path, duration_seconds) = {
            let state = self.inner.state.lock_unpoisoned();
            let job = state.jobs.get(job_id)?;
            (
                job.job_type,
                job.input_path.clone()?,
                job.media_info
                    .as_ref()
                    .and_then(|info| info.duration_seconds),
            )
        };

        if job_type != JobType::Video {
            return None;
        }

        let settings = self.settings();
        let capture_percent = settings.preview_capture_percent;
        let duration_seconds = self.resolve_duration_seconds_and_update_media_info(
            job_id,
            duration_seconds,
            &input_path,
            &settings.tools,
        );

        let (ffmpeg_path, _source, _did_download) =
            ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools).ok()?;

        let preview_path = job_runner::generate_preview_for_video(
            Path::new(&input_path),
            &ffmpeg_path,
            duration_seconds,
            capture_percent,
        )?;

        let preview_str = preview_path.to_string_lossy().into_owned();

        let delta_to_emit = {
            let mut state = self.inner.state.lock_unpoisoned();
            let base_snapshot_revision = state.queue_snapshot_revision;
            let patch = if let Some(job) = state.jobs.get_mut(job_id) {
                job.preview_path = Some(preview_str.clone());
                job.preview_revision = job.preview_revision.saturating_add(1);
                Some(TranscodeJobLiteDeltaPatch {
                    id: job.id.clone(),
                    status: None,
                    progress: None,
                    telemetry: None,
                    progress_out_time_seconds: None,
                    progress_speed: None,
                    progress_updated_at_ms: None,
                    progress_epoch: None,
                    elapsed_ms: None,
                    preview: Some(TranscodeJobLitePreviewDelta {
                        preview_path: Some(preview_str.clone()),
                        preview_revision: Some(job.preview_revision),
                    }),
                    preview_path: Some(preview_str.clone()),
                    preview_revision: Some(job.preview_revision),
                })
            } else {
                None
            };

            if let Some(patch) = patch {
                state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
                let delta_revision = state.queue_delta_revision;
                Some(QueueStateLiteDelta {
                    base_snapshot_revision,
                    delta_revision,
                    patches: vec![patch],
                })
            } else {
                None
            }
        };

        if let Some(delta) = delta_to_emit {
            notify_queue_lite_delta_listeners(&self.inner, delta);
        }
        Some(preview_str)
    }

    /// Ensure a cached preview image variant exists on disk for the given job.
    ///
    /// This does not mutate the job's `preview_path` or emit queue deltas; it
    /// simply returns a stable filesystem path for the requested preview size.
    pub fn ensure_job_preview_variant(
        &self,
        job_id: &str,
        height_px: u16,
    ) -> Result<Option<String>, String> {
        use std::path::Path;

        let (job_type, source_path, duration_seconds) = {
            let state = self.inner.state.lock_unpoisoned();
            let Some(job) = state.jobs.get(job_id) else {
                return Ok(None);
            };
            let source_path = Self::resolve_job_source_path(job.input_path.clone(), &job.filename);
            (
                job.job_type,
                source_path,
                job.media_info
                    .as_ref()
                    .and_then(|info| info.duration_seconds),
            )
        };

        if job_type != JobType::Video {
            return Ok(None);
        }

        let Some(source_path) = source_path else {
            return Ok(None);
        };

        let (height_px, q) = match height_px {
            120 => (120, 9),
            180 => (180, 8),
            360 => (360, 7),
            540 => (540, 7),
            720 => (720, 6),
            1080 => (1080, 6),
            _ => {
                return Err(
                    "unsupported preview height_px (allowed: 120,180,360,540,720,1080)".to_string(),
                );
            }
        };

        let settings = self.settings();
        let capture_percent = settings.preview_capture_percent;
        let duration_seconds = self.resolve_duration_seconds_and_update_media_info(
            job_id,
            duration_seconds,
            &source_path,
            &settings.tools,
        );

        let (ffmpeg_path, _source, _did_download) =
            match ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };

        let preview_path = job_runner::generate_preview_for_video_variant(
            Path::new(&source_path),
            &ffmpeg_path,
            duration_seconds,
            capture_percent,
            height_px,
            q,
        );

        Ok(preview_path.map(|p| p.to_string_lossy().into_owned()))
    }

    pub(super) fn refresh_video_previews_for_percent(
        &self,
        capture_percent: u8,
        refresh_token: u64,
        tools: &ExternalToolSettings,
    ) {
        use std::collections::HashSet;
        use std::fs;
        use std::path::{Path, PathBuf};

        let previews_root = match crate::ffui_core::previews_dir() {
            Ok(dir) => dir,
            Err(err) => {
                crate::debug_eprintln!(
                    "preview refresh skipped: failed to resolve previews dir: {err:#}"
                );
                return;
            }
        };

        let jobs_snapshot: Vec<(String, String, Option<f64>)> = {
            let state = self.inner.state.lock_unpoisoned();
            if state.preview_refresh_token != refresh_token {
                return;
            }
            state
                .jobs
                .values()
                .filter(|job| job.job_type == JobType::Video)
                .filter_map(|job| {
                    let input =
                        Self::resolve_job_source_path(job.input_path.clone(), &job.filename)?;
                    let duration = job
                        .media_info
                        .as_ref()
                        .and_then(|info| info.duration_seconds);
                    Some((job.id.clone(), input, duration))
                })
                .collect()
        };

        let (ffmpeg_path, _source, _did_download) =
            match ensure_tool_available(ExternalToolKind::Ffmpeg, tools) {
                Ok(v) => v,
                Err(err) => {
                    crate::debug_eprintln!(
                        "preview refresh skipped: failed to resolve ffmpeg: {err:#}"
                    );
                    return;
                }
            };

        let mut old_paths: Vec<String> = Vec::new();
        let mut preview_patches: Vec<TranscodeJobLiteDeltaPatch> = Vec::new();

        for (job_id, input_path, duration_seconds) in jobs_snapshot {
            {
                let state = self.inner.state.lock_unpoisoned();
                if state.preview_refresh_token != refresh_token {
                    return;
                }
            }

            let duration_seconds = duration_seconds.or_else(|| {
                crate::ffui_core::probe_video_duration_seconds_best_effort(
                    Path::new(&input_path),
                    tools,
                )
                .ok()
            });

            if duration_seconds.is_some() {
                let mut state = self.inner.state.lock_unpoisoned();
                if state.preview_refresh_token != refresh_token {
                    return;
                }
                if let Some(job) = state.jobs.get_mut(&job_id)
                    && job.job_type == JobType::Video
                {
                    match job.media_info.as_mut() {
                        Some(info) if info.duration_seconds.is_none() => {
                            info.duration_seconds = duration_seconds;
                        }
                        None => {
                            job.media_info = Some(MediaInfo {
                                duration_seconds,
                                width: None,
                                height: None,
                                frame_rate: None,
                                video_codec: None,
                                audio_codec: None,
                                size_mb: None,
                            });
                        }
                        _ => {}
                    }
                }
            }

            let generated = job_runner::generate_preview_for_video(
                Path::new(&input_path),
                &ffmpeg_path,
                duration_seconds,
                capture_percent,
            );

            let Some(preview_path) = generated else {
                continue;
            };

            let preview_str = preview_path.to_string_lossy().into_owned();

            let (previous_preview, next_preview_revision): (Option<String>, Option<u64>) = {
                let mut state = self.inner.state.lock_unpoisoned();
                if state.preview_refresh_token != refresh_token {
                    return;
                }
                match state.jobs.get_mut(&job_id) {
                    Some(job) if job.job_type == JobType::Video => {
                        let previous = job.preview_path.clone();
                        job.preview_path = Some(preview_str.clone());
                        job.preview_revision = job.preview_revision.saturating_add(1);
                        (previous, Some(job.preview_revision))
                    }
                    _ => (None, None),
                }
            };

            if let Some(preview_revision) = next_preview_revision {
                preview_patches.push(TranscodeJobLiteDeltaPatch {
                    id: job_id.clone(),
                    status: None,
                    progress: None,
                    telemetry: None,
                    progress_out_time_seconds: None,
                    progress_speed: None,
                    progress_updated_at_ms: None,
                    progress_epoch: None,
                    elapsed_ms: None,
                    preview: Some(TranscodeJobLitePreviewDelta {
                        preview_path: Some(preview_str.clone()),
                        preview_revision: Some(preview_revision),
                    }),
                    preview_path: Some(preview_str.clone()),
                    preview_revision: Some(preview_revision),
                });
            }

            if let Some(old_path) = previous_preview
                && old_path != preview_str
            {
                old_paths.push(old_path);
            }
        }

        let referenced_previews: HashSet<String> = {
            let state = self.inner.state.lock_unpoisoned();
            if state.preview_refresh_token != refresh_token {
                return;
            }
            state
                .jobs
                .values()
                .filter_map(|job| job.preview_path.clone())
                .collect()
        };

        for old_path in old_paths {
            if referenced_previews.contains(&old_path) {
                continue;
            }
            let old = PathBuf::from(&old_path);
            if !old.exists() {
                continue;
            }

            let safe_to_delete = old
                .canonicalize()
                .ok()
                .and_then(|candidate| {
                    previews_root
                        .canonicalize()
                        .ok()
                        .map(|root| (candidate, root))
                })
                .is_some_and(|(candidate, root)| candidate.starts_with(&root));

            if safe_to_delete {
                drop(fs::remove_file(&old));
            }
        }

        if preview_patches.is_empty() {
            return;
        }

        const MAX_PATCHES_PER_DELTA: usize = 256;
        let deltas: Vec<QueueStateLiteDelta> = {
            let mut state = self.inner.state.lock_unpoisoned();
            if state.preview_refresh_token != refresh_token {
                return;
            }

            let base_snapshot_revision = state.queue_snapshot_revision;
            let mut out = Vec::new();
            for chunk in preview_patches.chunks(MAX_PATCHES_PER_DELTA) {
                state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
                let delta_revision = state.queue_delta_revision;
                out.push(QueueStateLiteDelta {
                    base_snapshot_revision,
                    delta_revision,
                    patches: chunk.to_vec(),
                });
            }
            out
        };

        for delta in deltas {
            notify_queue_lite_delta_listeners(&self.inner, delta);
        }
    }
}

#[cfg(test)]
mod preview_refresh_path_resolution_tests {
    use super::TranscodingEngine;

    #[test]
    fn resolve_job_source_path_prefers_input_path() {
        let resolved = TranscodingEngine::resolve_job_source_path(
            Some("C:/videos/in.mp4".to_string()),
            "C:/videos/fallback.mp4",
        );
        assert_eq!(resolved.as_deref(), Some("C:/videos/in.mp4"));
    }

    #[test]
    fn resolve_job_source_path_uses_filename_when_path_like() {
        let resolved = TranscodingEngine::resolve_job_source_path(None, "C:/videos/legacy.mp4");
        assert_eq!(resolved.as_deref(), Some("C:/videos/legacy.mp4"));
    }

    #[test]
    fn resolve_job_source_path_ignores_bare_filename() {
        let resolved = TranscodingEngine::resolve_job_source_path(None, "legacy.mp4");
        assert_eq!(resolved, None);
    }
}
