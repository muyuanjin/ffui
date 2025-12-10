use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use anyhow::Result;

use crate::ffui_core::domain::{
    AutoCompressProgress, AutoCompressResult, FFmpegPreset, JobStatus, SmartScanConfig,
};
use crate::ffui_core::settings::{self, AppSettings};

use super::super::state::{
    Inner, SmartScanBatch, SmartScanBatchStatus, is_known_smart_scan_output_with_inner,
    notify_smart_scan_listeners, register_known_smart_scan_output_with_inner,
    update_smart_scan_batch_with_inner,
};
use super::audio::handle_audio_file;
use super::detection::{is_audio_file, is_image_file, is_smart_scan_style_output, is_video_file};
use super::helpers::{current_time_millis, notify_queue_listeners};
use super::image::handle_image_file;
use super::video::enqueue_smart_scan_video_job;

pub(crate) fn run_auto_compress(
    inner: &Arc<Inner>,
    root_path: String,
    config: SmartScanConfig,
) -> Result<AutoCompressResult> {
    let root = PathBuf::from(&root_path);
    if !root.exists() {
        return Err(anyhow::anyhow!("Root path does not exist: {root_path}"));
    }

    let (settings_snapshot, presets, batch_id, started_at_ms) = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.settings.smart_scan_defaults = config.clone();
        if let Err(err) = settings::save_settings(&state.settings) {
            eprintln!("failed to persist Smart Scan defaults to settings.json: {err:#}");
        }
        let settings_snapshot = state.settings.clone();
        let presets = state.presets.clone();

        let started_at_ms = current_time_millis();

        let mut hasher = DefaultHasher::new();
        root_path.hash(&mut hasher);
        started_at_ms.hash(&mut hasher);
        let batch_hash = hasher.finish();
        let batch_id = format!("auto-compress-{batch_hash:016x}");

        let batch = SmartScanBatch {
            batch_id: batch_id.clone(),
            root_path: root_path.clone(),
            // 每个批次独立携带 replace_original 配置，避免后续修改默认设置时影响
            // 之前已入队但尚未处理完的 Smart Scan 任务。
            replace_original: config.replace_original,
            status: SmartScanBatchStatus::Scanning,
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            child_job_ids: Vec::new(),
            started_at_ms,
            completed_at_ms: None,
        };

        state.smart_scan_batches.insert(batch_id.clone(), batch);

        (settings_snapshot, presets, batch_id, started_at_ms)
    };

    // Emit an initial progress snapshot so the frontend can show that the
    // batch has started even before any files are discovered.
    notify_smart_scan_listeners(
        inner,
        AutoCompressProgress {
            root_path: root_path.clone(),
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            batch_id: batch_id.clone(),
        },
    );

    // Kick off the actual Smart Scan work on a background thread so the
    // Tauri command can return immediately with lightweight batch metadata.
    let inner_clone = inner.clone();
    let config_clone = config.clone();
    let batch_id_for_thread = batch_id.clone();
    thread::Builder::new()
        .name(format!("smart-scan-{batch_id_for_thread}"))
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
        .expect("failed to spawn Smart Scan background worker");

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
    inner: &Inner,
    root: PathBuf,
    config: SmartScanConfig,
    settings_snapshot: AppSettings,
    presets: Vec<FFmpegPreset>,
    batch_id: String,
) {
    let mut queue_dirty = false;
    let mut waiting_jobs_enqueued = false;

    // 单次流式扫描：在遍历目录树时直接应用 Smart Scan 规则并即时建队列任务，
    // 避免“整棵树预扫描完才开始建任务”的长时间空窗。
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

            // 所有文件都计入扫描计数。
            update_smart_scan_batch_with_inner(inner, &batch_id, false, |batch| {
                batch.total_files_scanned = batch.total_files_scanned.saturating_add(1);
            });

            // 已知 Smart Scan 输出：登记到已知集合并跳过，避免作为候选再次入队。
            if is_smart_scan_style_output(&path) {
                register_known_smart_scan_output_with_inner(inner, &path);
                continue;
            }

            if is_known_smart_scan_output_with_inner(inner, &path) {
                // 已知输出：仅计入扫描，不作为候选。
                continue;
            }

            if is_image_file(&path) {
                // 图像仍由后台线程同步处理，但整个流程在 Smart Scan 专用线程中，
                // 不再阻塞 Tauri 命令线程。
                match handle_image_file(inner, &path, &config, &settings_snapshot, &batch_id) {
                    Ok(job) => {
                        // 将图像任务注册到队列状态中，使其成为队列事件的一部分。
                        {
                            let mut state = inner.state.lock().expect("engine state poisoned");
                            state.jobs.insert(job.id.clone(), job.clone());
                        }

                        let is_terminal = matches!(
                            job.status,
                            JobStatus::Completed | JobStatus::Skipped | JobStatus::Failed
                        );

                        queue_dirty = true;
                        if matches!(job.status, JobStatus::Waiting) {
                            waiting_jobs_enqueued = true;
                        }

                        // 每个图像候选都立即视为"已处理"：压缩逻辑在当前线程同步完成。
                        update_smart_scan_batch_with_inner(inner, &batch_id, true, |batch| {
                            batch.total_candidates = batch.total_candidates.saturating_add(1);
                            batch.child_job_ids.push(job.id.clone());
                            if is_terminal {
                                batch.total_processed = batch.total_processed.saturating_add(1);
                            }
                        });

                        // 图像输出成功生成时，记录为已知输出，避免后续批次重新压缩。
                        if let Some(ref output_path) = job.output_path {
                            let output = PathBuf::from(output_path);
                            if matches!(job.status, JobStatus::Completed) {
                                register_known_smart_scan_output_with_inner(inner, &output);
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!(
                            "auto-compress: failed to handle image file {}: {err:#}",
                            path.display()
                        );
                    }
                }
            } else if is_audio_file(&path) {
                // 仅在音频过滤启用且扩展名命中时才作为 Smart Scan 候选。
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

                match handle_audio_file(
                    inner,
                    &path,
                    &config,
                    &settings_snapshot,
                    &presets,
                    &batch_id,
                ) {
                    Ok(job) => {
                        {
                            let mut state = inner.state.lock().expect("engine state poisoned");
                            state.jobs.insert(job.id.clone(), job.clone());
                        }

                        let is_terminal = matches!(
                            job.status,
                            JobStatus::Completed
                                | JobStatus::Skipped
                                | JobStatus::Failed
                                | JobStatus::Cancelled
                        );

                        queue_dirty = true;
                        if matches!(job.status, JobStatus::Waiting) {
                            waiting_jobs_enqueued = true;
                        }

                        update_smart_scan_batch_with_inner(inner, &batch_id, true, |batch| {
                            batch.total_candidates = batch.total_candidates.saturating_add(1);
                            batch.child_job_ids.push(job.id.clone());
                            if is_terminal {
                                batch.total_processed = batch.total_processed.saturating_add(1);
                            }
                        });
                    }
                    Err(err) => {
                        eprintln!(
                            "auto-compress: failed to handle audio file {}: {err:#}",
                            path.display()
                        );
                    }
                }
            } else if is_video_file(&path) {
                let preset = presets
                    .iter()
                    .find(|p| p.id == config.video_preset_id)
                    .cloned();

                if let Some(preset) = preset {
                    let job = enqueue_smart_scan_video_job(
                        inner,
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

                    update_smart_scan_batch_with_inner(inner, &batch_id, true, |batch| {
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
                        } else if matches!(batch.status, SmartScanBatchStatus::Scanning) {
                            // 当存在至少一个真实入队的候选时，将批次标记为 Running。
                            batch.status = SmartScanBatchStatus::Running;
                        }
                    });
                } else {
                    // 当没有匹配的预设时，仍然增加 candidates 计数，并立刻将该"任务"视为已处理。
                    update_smart_scan_batch_with_inner(inner, &batch_id, true, |batch| {
                        batch.total_candidates = batch.total_candidates.saturating_add(1);
                        batch.total_processed = batch.total_processed.saturating_add(1);
                    });
                }
            }
        }
    }

    // 扫描阶段结束后，如果没有任何候选，则批次立即视为完成。
    update_smart_scan_batch_with_inner(inner, &batch_id, true, |batch| {
        if batch.total_candidates == 0 {
            batch.status = SmartScanBatchStatus::Completed;
            batch.completed_at_ms = Some(current_time_millis());
        } else if matches!(batch.status, SmartScanBatchStatus::Scanning) {
            batch.status = SmartScanBatchStatus::Running;
        }
    });

    // 扫描结束后统一广播队列快照，使前端一次性看到所有子任务。
    if queue_dirty {
        notify_queue_listeners(inner);
    }

    // 扫描完成后再唤醒 worker，避免在检测尚未完成时任务逐个启动。
    if waiting_jobs_enqueued {
        inner.cv.notify_all();
    }
}

#[allow(dead_code)]
pub(crate) fn smart_scan_batch_summary(
    inner: &Inner,
    batch_id: &str,
) -> Option<AutoCompressResult> {
    let state = inner.state.lock().expect("engine state poisoned");
    let batch = state.smart_scan_batches.get(batch_id)?.clone();

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
