use std::collections::hash_map::DefaultHasher;
use std::hash::{
    Hash,
    Hasher,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::{
    fs,
    thread,
};

use anyhow::Result;

use super::super::state::{
    BatchCompressBatch,
    BatchCompressBatchStatus,
    Inner,
    is_known_batch_compress_output_with_inner,
    notify_batch_compress_listeners,
    update_batch_compress_batch_with_inner,
};
use super::super::worker_utils::{
    append_job_log_line,
    mark_batch_compress_child_processed,
};
use super::audio::handle_audio_file_with_id;
use super::detection::{
    is_audio_file,
    is_image_file,
    is_video_file,
};
use super::helpers::{
    current_time_millis,
    next_job_id,
    notify_queue_listeners,
};
use super::image::handle_image_file_with_id;
use super::orchestrator_helpers::{
    insert_audio_stub_job,
    insert_image_stub_job,
    set_job_processing,
};
use super::video::enqueue_batch_compress_video_job;
use crate::ffui_core::domain::{
    AutoCompressProgress,
    AutoCompressResult,
    BatchCompressConfig,
    FFmpegPreset,
    JobStatus,
};
use crate::ffui_core::settings::{
    self,
    AppSettings,
};

pub(crate) fn run_auto_compress(
    inner: &Arc<Inner>,
    root_path: String,
    config: BatchCompressConfig,
) -> Result<AutoCompressResult> {
    let root = PathBuf::from(&root_path);
    if !root.exists() {
        return Err(anyhow::anyhow!("Root path does not exist: {root_path}"));
    }

    let (settings_snapshot, presets, batch_id, started_at_ms) = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.settings.batch_compress_defaults = config.clone();
        if let Err(err) = settings::save_settings(&state.settings) {
            eprintln!("failed to persist Batch Compress defaults to settings.json: {err:#}");
        }
        let settings_snapshot = state.settings.clone();
        let presets = state.presets.clone();

        let started_at_ms = current_time_millis();

        let mut hasher = DefaultHasher::new();
        root_path.hash(&mut hasher);
        started_at_ms.hash(&mut hasher);
        let batch_hash = hasher.finish();
        let batch_id = format!("auto-compress-{batch_hash:016x}");

        let batch = BatchCompressBatch {
            batch_id: batch_id.clone(),
            root_path: root_path.clone(),
            // 每个批次独立携带 replace_original 配置，避免后续修改默认设置时影响
            // 之前已入队但尚未处理完的 Batch Compress 任务。
            replace_original: config.replace_original,
            status: BatchCompressBatchStatus::Scanning,
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            child_job_ids: Vec::new(),
            started_at_ms,
            completed_at_ms: None,
        };

        state.batch_compress_batches.insert(batch_id.clone(), batch);

        (settings_snapshot, presets, batch_id, started_at_ms)
    };

    // Emit an initial progress snapshot so the frontend can show that the
    // batch has started even before any files are discovered.
    notify_batch_compress_listeners(
        inner,
        AutoCompressProgress {
            root_path: root_path.clone(),
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            batch_id: batch_id.clone(),
            completed_at_ms: 0,
        },
    );

    // Kick off the actual Batch Compress work on a background thread so the
    // Tauri command can return immediately with lightweight batch metadata.
    let inner_clone = inner.clone();
    let config_clone = config.clone();
    let batch_id_for_thread = batch_id.clone();
    thread::Builder::new()
        .name(format!("batch-compress-{batch_id_for_thread}"))
        .spawn(move || {
            run_auto_compress_background(
                inner_clone,
                root,
                config_clone,
                settings_snapshot,
                presets,
                batch_id_for_thread,
            );
        })
        .expect("failed to spawn Batch Compress background worker");

    Ok(AutoCompressResult {
        root_path,
        jobs: Vec::new(),
        total_files_scanned: 0,
        total_candidates: 0,
        total_processed: 0,
        batch_id,
        started_at_ms,
        completed_at_ms: 0,
    })
}

fn run_auto_compress_background(
    inner: Arc<Inner>,
    root: PathBuf,
    config: BatchCompressConfig,
    settings_snapshot: AppSettings,
    presets: Arc<Vec<FFmpegPreset>>,
    batch_id: String,
) {
    let mut queue_dirty = false;
    let mut waiting_jobs_enqueued = false;

    // 第一次遍历：只收集文件列表并更新扫描进度，不做任何重处理。
    let mut all_files: Vec<PathBuf> = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(err) => {
                eprintln!("auto-compress: failed to read dir {}: {err}", dir.display());
                continue;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            update_batch_compress_batch_with_inner(&inner, &batch_id, false, |batch| {
                batch.total_files_scanned = batch.total_files_scanned.saturating_add(1);
            });

            all_files.push(path);
        }
    }

    #[derive(Clone, Copy)]
    enum MediaTaskKind {
        Image,
        Audio,
    }

    let mut pending_media_tasks: Vec<(String, PathBuf, MediaTaskKind)> = Vec::new();

    // 第二次遍历：基于快照建任务，快速推给 UI；重处理放到异步线程。
    for path in all_files {
        if is_known_batch_compress_output_with_inner(&inner, &path) {
            continue;
        }

        if is_image_file(&path) {
            let job_id = next_job_id(&inner);
            insert_image_stub_job(&inner, &job_id, &path, &config, &batch_id);

            queue_dirty = true;

            update_batch_compress_batch_with_inner(&inner, &batch_id, true, |batch| {
                batch.total_candidates = batch.total_candidates.saturating_add(1);
                batch.child_job_ids.push(job_id.clone());
                if matches!(batch.status, BatchCompressBatchStatus::Scanning) {
                    batch.status = BatchCompressBatchStatus::Running;
                }
            });

            pending_media_tasks.push((job_id, path, MediaTaskKind::Image));
        } else if is_audio_file(&path) {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();

            let audio_filter = &config.audio_filter;
            let mut passes_filter = audio_filter.enabled;
            if passes_filter
                && !audio_filter.extensions.is_empty()
                && !audio_filter
                    .extensions
                    .iter()
                    .any(|e| e.eq_ignore_ascii_case(&ext))
            {
                passes_filter = false;
            }

            if !passes_filter {
                continue;
            }

            let job_id = next_job_id(&inner);
            insert_audio_stub_job(&inner, &job_id, &path, &config, &batch_id);

            queue_dirty = true;

            update_batch_compress_batch_with_inner(&inner, &batch_id, true, |batch| {
                batch.total_candidates = batch.total_candidates.saturating_add(1);
                batch.child_job_ids.push(job_id.clone());
                if matches!(batch.status, BatchCompressBatchStatus::Scanning) {
                    batch.status = BatchCompressBatchStatus::Running;
                }
            });

            pending_media_tasks.push((job_id, path, MediaTaskKind::Audio));
        } else if is_video_file(&path) {
            let preset = presets
                .iter()
                .find(|p| p.id == config.video_preset_id)
                .cloned();

            if let Some(preset) = preset {
                let job = enqueue_batch_compress_video_job(
                    &inner,
                    &path,
                    &config,
                    &settings_snapshot,
                    &preset,
                    &batch_id,
                    false,
                );

                queue_dirty = true;
                if matches!(job.status, JobStatus::Waiting) {
                    waiting_jobs_enqueued = true;
                }

                update_batch_compress_batch_with_inner(&inner, &batch_id, true, |batch| {
                    batch.total_candidates = batch.total_candidates.saturating_add(1);
                    batch.child_job_ids.push(job.id.clone());

                    let is_terminal = matches!(
                        job.status,
                        JobStatus::Completed
                            | JobStatus::Skipped
                            | JobStatus::Failed
                            | JobStatus::Cancelled
                    );
                    if is_terminal {
                        batch.total_processed = batch.total_processed.saturating_add(1);
                    } else if matches!(batch.status, BatchCompressBatchStatus::Scanning) {
                        batch.status = BatchCompressBatchStatus::Running;
                    }
                });
            } else {
                // When there is no matching preset for the configured videoPresetId,
                // we still count the file as a scanned candidate and immediately
                // mark it as "processed" so overall Batch Compress statistics remain
                // consistent. No queue job is enqueued for such entries.
                update_batch_compress_batch_with_inner(&inner, &batch_id, true, |batch| {
                    batch.total_candidates = batch.total_candidates.saturating_add(1);
                    batch.total_processed = batch.total_processed.saturating_add(1);
                });
            }
        }
    }

    update_batch_compress_batch_with_inner(&inner, &batch_id, true, |batch| {
        if batch.total_candidates == 0 {
            // Pure "scan only" batch with no eligible candidates: treat as
            // completed once the directory walk finishes so the frontend can
            // safely hide the empty composite card.
            batch.status = BatchCompressBatchStatus::Completed;
            batch.completed_at_ms = Some(current_time_millis());
        } else if batch.child_job_ids.is_empty()
            && batch.total_processed >= batch.total_candidates
            && !matches!(
                batch.status,
                BatchCompressBatchStatus::Completed | BatchCompressBatchStatus::Failed
            )
        {
            // All candidates have been accounted for but no queue jobs were
            // ever enqueued (e.g. missing preset). In this edge case the
            // batch is logically complete even though there are no children,
            // so mark it as Completed to keep delete_batch_compress_batch and
            // UI semantics consistent.
            batch.status = BatchCompressBatchStatus::Completed;
            if batch.completed_at_ms.is_none() {
                batch.completed_at_ms = Some(current_time_millis());
            }
        } else if batch.total_processed >= batch.total_candidates
            && !matches!(
                batch.status,
                BatchCompressBatchStatus::Completed | BatchCompressBatchStatus::Failed
            )
        {
            // All candidates have been processed. This covers cases where every
            // Batch Compress child job is immediately terminal at enqueue time
            // (e.g. size threshold or codec skip), so no worker thread will ever
            // "finish" a job and advance the batch status later.
            batch.status = BatchCompressBatchStatus::Completed;
            if batch.completed_at_ms.is_none() {
                batch.completed_at_ms = Some(current_time_millis());
            }
        } else if matches!(batch.status, BatchCompressBatchStatus::Scanning) {
            batch.status = BatchCompressBatchStatus::Running;
        }
    });

    if queue_dirty {
        notify_queue_listeners(&inner);
    }

    if waiting_jobs_enqueued {
        inner.cv.notify_all();
    }

    if !pending_media_tasks.is_empty() {
        let inner_clone = Arc::clone(&inner);
        let config_clone = config.clone();
        let settings_clone = settings_snapshot.clone();
        let presets_clone = presets.clone();
        let batch_id_clone = batch_id.clone();

        thread::Builder::new()
            .name(format!("batch-compress-media-worker-{batch_id}"))
            .spawn(move || {
                for (job_id, path, kind) in pending_media_tasks {
                    set_job_processing(&inner_clone, &job_id);
                    let result = match kind {
                        MediaTaskKind::Image => handle_image_file_with_id(
                            &inner_clone,
                            &path,
                            &config_clone,
                            &settings_clone,
                            &batch_id_clone,
                            Some(job_id.clone()),
                        ),
                        MediaTaskKind::Audio => handle_audio_file_with_id(
                            &inner_clone,
                            &path,
                            &config_clone,
                            &settings_clone,
                            &presets_clone,
                            &batch_id_clone,
                            Some(job_id.clone()),
                        ),
                    };

                    match result {
                        Ok(job) => {
                            let mut state =
                                inner_clone.state.lock().expect("engine state poisoned");
                            state.jobs.insert(job.id.clone(), job);
                        }
                        Err(err) => {
                            let mut state =
                                inner_clone.state.lock().expect("engine state poisoned");
                            if let Some(job) = state.jobs.get_mut(&job_id) {
                                job.status = JobStatus::Failed;
                                job.progress = 100.0;
                                job.end_time = Some(current_time_millis());
                                let reason =
                                    format!("Batch Compress media compression failed: {err:#}");
                                job.failure_reason = Some(reason.clone());
                                append_job_log_line(job, reason);
                            }
                        }
                    }

                    notify_queue_listeners(&inner_clone);
                    mark_batch_compress_child_processed(&inner_clone, &job_id);
                }
            })
            .expect("failed to spawn batch compress media worker thread");
    }
}

#[allow(dead_code)]
pub(crate) fn batch_compress_batch_summary(
    inner: &Inner,
    batch_id: &str,
) -> Option<AutoCompressResult> {
    let state = inner.state.lock().expect("engine state poisoned");
    let batch = state.batch_compress_batches.get(batch_id)?.clone();

    let mut jobs = Vec::new();
    for job in state.jobs.values() {
        if job.batch_id.as_deref() == Some(batch_id) {
            jobs.push(job.clone());
        }
    }

    Some(AutoCompressResult {
        root_path: batch.root_path,
        jobs,
        total_files_scanned: batch.total_files_scanned,
        total_candidates: batch.total_candidates,
        total_processed: batch.total_processed,
        batch_id: batch.batch_id,
        started_at_ms: batch.started_at_ms,
        completed_at_ms: batch.completed_at_ms.unwrap_or(batch.started_at_ms),
    })
}
