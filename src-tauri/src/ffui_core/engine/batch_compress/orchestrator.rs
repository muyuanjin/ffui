use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::{fs, thread};

use anyhow::{Context, Result};

use super::super::state::{
    BATCH_COMPRESS_PROGRESS_EVERY, BatchCompressBatch, BatchCompressBatchStatus, Inner,
    is_known_batch_compress_output_with_inner, notify_batch_compress_listeners,
    update_batch_compress_batch_with_inner,
};
use super::detection::{
    is_audio_file, is_batch_compress_style_output, is_image_file, is_video_file,
    passes_media_filter,
};
use super::helpers::{current_time_millis, next_job_id, notify_queue_listeners};
use super::orchestrator_helpers::{insert_audio_stub_job, insert_image_stub_job};
use super::video::enqueue_batch_compress_video_job;
use crate::ffui_core::domain::{
    AutoCompressProgress, AutoCompressResult, BatchCompressConfig, FFmpegPreset, ImageTargetFormat,
    JobStatus,
};
use crate::ffui_core::settings::{self, AppSettings};
use crate::sync_ext::MutexExt;

#[cfg(test)]
pub(crate) fn store_media_worker_result(
    inner: &Inner,
    job_id: &str,
    job: crate::ffui_core::domain::TranscodeJob,
) {
    let mut state = inner.state.lock_unpoisoned();
    state.cancelled_jobs.remove(job_id);
    state.jobs.insert(job.id.clone(), job);
}

pub(crate) fn run_auto_compress(
    inner: &Arc<Inner>,
    root_path: String,
    mut config: BatchCompressConfig,
) -> Result<AutoCompressResult> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(anyhow::anyhow!("Root path is not a directory: {root_path}"));
    }
    fs::read_dir(&root)
        .with_context(|| format!("Root path is not readable: {}", root.display()))?;
    config.root_path = Some(root_path.clone());

    let (settings_snapshot, presets, batch_id, started_at_ms) = {
        let mut state = inner.state.lock_unpoisoned();
        state.settings.batch_compress_defaults = config.clone();
        let settings_snapshot = state.settings.clone();
        let presets = state.presets.clone();

        let started_at_ms = current_time_millis();

        let mut hasher = DefaultHasher::new();
        root_path.hash(&mut hasher);
        started_at_ms.hash(&mut hasher);
        let batch_hash = hasher.finish();
        let batch_id = format!("auto-compress-{batch_hash:016x}");

        let mut batch = BatchCompressBatch::new(batch_id.clone(), root_path.clone(), started_at_ms);
        // 每个批次独立携带 Batch Compress 配置快照，避免后续修改默认设置时影响
        // 之前已入队但尚未处理完的任务。
        batch.replace_original = config.replace_original;
        batch.min_image_size_kb = config.min_image_size_kb;
        batch.min_audio_size_kb = config.min_audio_size_kb;
        batch.image_target_format = config.image_target_format;
        batch.output_policy = config.output_policy.clone();
        batch.saving_condition_type = config.saving_condition_type;
        batch.min_saving_ratio = config.min_saving_ratio;
        batch.min_saving_absolute_mb = config.min_saving_absolute_mb;

        state.batch_compress_batches.insert(batch_id.clone(), batch);
        drop(state);

        (settings_snapshot, presets, batch_id, started_at_ms)
    };

    if let Err(err) = settings::save_settings(&settings_snapshot) {
        crate::debug_eprintln!(
            "failed to persist Batch Compress defaults to settings.json: {err:#}"
        );
    }

    // Emit an initial progress snapshot so the frontend can show that the
    // batch has started even before any files are discovered.
    let initial_progress = AutoCompressProgress {
        root_path: root_path.clone(),
        total_files_scanned: 0,
        total_candidates: 0,
        total_processed: 0,
        batch_id: batch_id.clone(),
        completed_at_ms: 0,
    };
    notify_batch_compress_listeners(inner, &initial_progress);

    // Kick off the actual Batch Compress work on a background thread so the
    // Tauri command can return immediately with lightweight batch metadata.
    let inner_clone = inner.clone();
    let config_clone = config;
    let batch_id_for_thread = batch_id.clone();
    let spawned = thread::Builder::new()
        .name(format!("batch-compress-{batch_id_for_thread}"))
        .spawn(move || {
            run_auto_compress_background(
                &inner_clone,
                root,
                config_clone,
                settings_snapshot,
                presets,
                batch_id_for_thread,
            );
        })
        .map(|_| ());

    if let Err(err) = spawned {
        update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
            batch.status = BatchCompressBatchStatus::Failed;
            batch.completed_at_ms = Some(current_time_millis());
        });
        crate::debug_eprintln!("failed to spawn Batch Compress background worker: {err}");
        return Err(anyhow::anyhow!(
            "failed to start Batch Compress worker thread: {err}"
        ));
    }

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
    inner: &Arc<Inner>,
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
    let mut pending_scanned: u64 = 0;
    let mut scanned_total: u64 = 0;
    let mut last_force_flush = Instant::now();
    let mut stack = vec![root];
    let mut visited_dirs: HashSet<PathBuf> = HashSet::new();
    while let Some(dir) = stack.pop() {
        if let Ok(canonical) = dir.canonicalize()
            && !visited_dirs.insert(canonical)
        {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(err) => {
                crate::debug_eprintln!(
                    "auto-compress: failed to read dir {}: {err}",
                    dir.display()
                );
                continue;
            }
        };

        for entry_result in entries {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(err) => {
                    crate::debug_eprintln!(
                        "auto-compress: failed to read an entry under {}: {err}",
                        dir.display()
                    );
                    continue;
                }
            };
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(err) => {
                    crate::debug_eprintln!(
                        "auto-compress: failed to stat entry {}: {err}",
                        path.display()
                    );
                    continue;
                }
            };
            if file_type.is_symlink() {
                match fs::metadata(&path) {
                    Ok(target_meta) if target_meta.is_dir() => {
                        crate::debug_eprintln!(
                            "auto-compress: skipping symlink directory {}",
                            path.display()
                        );
                        continue;
                    }
                    Ok(target_meta) if target_meta.is_file() => {}
                    Ok(_) => {
                        crate::debug_eprintln!(
                            "auto-compress: skipping symlink with unsupported target {}",
                            path.display()
                        );
                        continue;
                    }
                    Err(err) => {
                        crate::debug_eprintln!(
                            "auto-compress: failed to stat symlink target {}: {err}",
                            path.display()
                        );
                        continue;
                    }
                }
            } else if file_type.is_dir() {
                stack.push(path);
                continue;
            } else if !file_type.is_file() {
                continue;
            }

            scanned_total = scanned_total.saturating_add(1);

            // For small directory trees, keep the UI responsive by emitting per-file
            // progress updates up to the first BATCH_COMPRESS_PROGRESS_EVERY items.
            // This caps the lock contention at a small constant while improving
            // perceived responsiveness for typical "few dozen files" use cases.
            if scanned_total < BATCH_COMPRESS_PROGRESS_EVERY {
                update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
                    batch.total_files_scanned = batch.total_files_scanned.saturating_add(1);
                });
            } else {
                pending_scanned = pending_scanned.saturating_add(1);
                if pending_scanned >= BATCH_COMPRESS_PROGRESS_EVERY {
                    let flush = pending_scanned - (pending_scanned % BATCH_COMPRESS_PROGRESS_EVERY);
                    update_batch_compress_batch_with_inner(inner, &batch_id, false, |batch| {
                        batch.total_files_scanned = batch.total_files_scanned.saturating_add(flush);
                    });
                    pending_scanned -= flush;
                }

                // Slow/remote filesystems can make directory walks take long enough
                // that only emitting at multiples of 32 feels "stuck". Ensure we
                // flush partial progress at a coarse time interval.
                if pending_scanned > 0 && last_force_flush.elapsed() >= Duration::from_millis(200) {
                    let flush = pending_scanned;
                    update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
                        batch.total_files_scanned = batch.total_files_scanned.saturating_add(flush);
                    });
                    pending_scanned = 0;
                    last_force_flush = Instant::now();
                }
            }

            all_files.push(path);
        }
    }

    if pending_scanned > 0 {
        update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
            batch.total_files_scanned = batch.total_files_scanned.saturating_add(pending_scanned);
        });
    }

    // 第二次遍历：基于快照建任务，快速推给 UI；重处理放到异步线程。
    for path in all_files {
        if is_known_batch_compress_output_with_inner(inner, &path) {
            continue;
        }

        if is_image_file(&path) {
            if !passes_media_filter(&path, &config.image_filter) {
                continue;
            }
            let is_avif_to_webp_input = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("avif"))
                && matches!(config.image_target_format, ImageTargetFormat::Webp);
            if is_batch_compress_style_output(&path) && !is_avif_to_webp_input {
                continue;
            }
            let job_id = next_job_id(inner);
            insert_image_stub_job(inner, &job_id, &path, &config, &batch_id);
            queue_dirty = true;
            waiting_jobs_enqueued = true;
        } else if is_audio_file(&path) {
            if is_batch_compress_style_output(&path) {
                continue;
            }
            if !passes_media_filter(&path, &config.audio_filter) {
                continue;
            }

            let job_id = next_job_id(inner);
            insert_audio_stub_job(inner, &job_id, &path, &config, &batch_id);
            queue_dirty = true;
            waiting_jobs_enqueued = true;
        } else if is_video_file(&path) {
            if is_batch_compress_style_output(&path) {
                continue;
            }
            if !passes_media_filter(&path, &config.video_filter) {
                continue;
            }
            let preset = presets
                .iter()
                .find(|p| p.id == config.video_preset_id)
                .cloned();

            if let Some(preset) = preset {
                let job = enqueue_batch_compress_video_job(
                    inner,
                    &path,
                    &config,
                    &settings_snapshot,
                    &preset,
                    &batch_id,
                    false,
                );

                queue_dirty = true;
                if matches!(job.status, JobStatus::Queued) {
                    waiting_jobs_enqueued = true;
                }

                update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
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
                    }
                });
            } else {
                // When there is no matching preset for the configured videoPresetId,
                // we still count the file as a scanned candidate and immediately
                // mark it as "processed" so overall Batch Compress statistics remain
                // consistent. No queue job is enqueued for such entries.
                update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
                    batch.total_candidates = batch.total_candidates.saturating_add(1);
                    batch.total_processed = batch.total_processed.saturating_add(1);
                });
            }
        }
    }

    update_batch_compress_batch_with_inner(inner, &batch_id, true, |batch| {
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
        notify_queue_listeners(inner);
    }

    if waiting_jobs_enqueued {
        inner.cv.notify_all();
    }
}
