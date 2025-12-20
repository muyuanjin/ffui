use super::state::notify_queue_listeners;
use super::{
    TranscodingEngine,
    job_runner,
};
use crate::ffui_core::domain::JobType;
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{
    ExternalToolKind,
    ensure_tool_available,
};

impl TranscodingEngine {
    /// Ensure a video job has a readable preview image on disk.
    ///
    /// If the preview image is missing or unreadable, regenerate it using the
    /// latest `preview_capture_percent` setting and update the job's
    /// `preview_path`, then broadcast a queue snapshot so the UI refreshes.
    ///
    /// Returns the resolved preview path when available, otherwise None.
    pub fn ensure_job_preview(&self, job_id: &str) -> Option<String> {
        use std::path::Path;

        let (job_type, input_path, duration_seconds) = {
            let state = self.inner.state.lock().expect("engine state poisoned");
            let job = state.jobs.get(job_id)?;
            (
                job.job_type.clone(),
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

        let (ffmpeg_path, _source, _did_download) =
            ensure_tool_available(ExternalToolKind::Ffmpeg, &settings.tools).ok()?;

        let preview_path = job_runner::generate_preview_for_video(
            Path::new(&input_path),
            &ffmpeg_path,
            duration_seconds,
            capture_percent,
        )?;

        let preview_str = preview_path.to_string_lossy().into_owned();

        {
            let mut state = self.inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.preview_path = Some(preview_str.clone());
                job.preview_revision = job.preview_revision.saturating_add(1);
            }
        }

        notify_queue_listeners(&self.inner);
        Some(preview_str)
    }

    pub(super) fn refresh_video_previews_for_percent(
        &self,
        capture_percent: u8,
        refresh_token: u64,
        tools: ExternalToolSettings,
    ) {
        use std::collections::HashSet;
        use std::fs;
        use std::path::{
            Path,
            PathBuf,
        };

        let previews_root = crate::ffui_core::previews_dir()
            .unwrap_or_else(|_| PathBuf::from(".").join("previews"));

        let jobs_snapshot: Vec<(String, String, Option<f64>)> = {
            let state = self.inner.state.lock().expect("engine state poisoned");
            if state.preview_refresh_token != refresh_token {
                return;
            }
            state
                .jobs
                .values()
                .filter(|job| job.job_type == JobType::Video)
                .filter_map(|job| {
                    let input = job.input_path.clone()?;
                    let duration = job
                        .media_info
                        .as_ref()
                        .and_then(|info| info.duration_seconds);
                    Some((job.id.clone(), input, duration))
                })
                .collect()
        };

        let (ffmpeg_path, _source, _did_download) =
            match ensure_tool_available(ExternalToolKind::Ffmpeg, &tools) {
                Ok(v) => v,
                Err(err) => {
                    eprintln!("preview refresh skipped: failed to resolve ffmpeg: {err:#}");
                    return;
                }
            };

        let mut old_paths: Vec<String> = Vec::new();

        for (job_id, input_path, duration_seconds) in jobs_snapshot {
            {
                let state = self.inner.state.lock().expect("engine state poisoned");
                if state.preview_refresh_token != refresh_token {
                    return;
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

            let previous_preview: Option<String> = {
                let mut state = self.inner.state.lock().expect("engine state poisoned");
                if state.preview_refresh_token != refresh_token {
                    return;
                }
                match state.jobs.get_mut(&job_id) {
                    Some(job) if job.job_type == JobType::Video => {
                        let previous = job.preview_path.clone();
                        job.preview_path = Some(preview_str.clone());
                        job.preview_revision = job.preview_revision.saturating_add(1);
                        previous
                    }
                    _ => None,
                }
            };

            if let Some(old_path) = previous_preview
                && old_path != preview_str
            {
                old_paths.push(old_path);
            }
        }

        let referenced_previews: HashSet<String> = {
            let state = self.inner.state.lock().expect("engine state poisoned");
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
                .map(|(candidate, root)| candidate.starts_with(&root))
                .unwrap_or(false);

            if safe_to_delete {
                let _ = fs::remove_file(&old);
            }
        }

        notify_queue_listeners(&self.inner);
    }
}
