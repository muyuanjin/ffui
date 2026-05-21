#[cfg(test)]
mod execute_success_finalize_tests {
    use super::*;
    use crate::ffui_core::WaitMetadata;
    use crate::ffui_core::domain::{
        BatchCompressSavingCondition, ImageTargetFormat, JobSource, OutputPolicy,
        SavingConditionType,
    };
    use crate::ffui_core::engine::state::{BatchCompressBatch, BatchCompressBatchStatus};
    use crate::sync_ext::MutexExt;

    fn make_video_job(
        job_id: &str,
        last_progress_frame: u64,
    ) -> crate::ffui_core::domain::TranscodeJob {
        use crate::ffui_core::domain::{JobSource, JobStatus, JobType, MediaInfo, TranscodeJob};

        TranscodeJob {
            id: job_id.to_string(),
            filename: format!("C:/videos/{job_id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: JobStatus::Processing,
            progress: 0.0,
            start_time: Some(1),
            end_time: None,
            processing_started_ms: Some(1),
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: None,
            created_time_ms: None,
            modified_time_ms: None,
            output_path: None,
            output_policy: None,
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            }),
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            batch_compress_saving_condition: None,
            wait_metadata: Some(WaitMetadata {
                last_progress_percent: None,
                processed_wall_millis: None,
                processed_seconds: None,
                target_seconds: None,
                progress_epoch: None,
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: Some(last_progress_frame),
                tmp_output_path: None,
                segments: None,
                segment_end_targets: None,
            }),
        }
    }

    #[test]
    fn finalize_successful_transcode_job_emits_terminal_queue_lite_delta() {
        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = Inner::new(vec![preset], AppSettings::default());
        let job_id = "job-terminal-delta".to_string();
        {
            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(job_id.clone(), make_video_job(&job_id, 100));
        }

        let deltas = capture_queue_lite_deltas_for_tests(&inner);

        finalize_successful_transcode_job(
            &inner,
            FinalizeSuccessfulTranscodeJobArgs {
                job_id: &job_id,
                preset_id: "preset-1",
                output_path: &dir.path().join("out.mp4"),
                original_size_bytes: 100 * 1024 * 1024,
                final_output_size_bytes: 50 * 1024 * 1024,
                elapsed: 10.0,
                input_times: None,
            },
        )
        .expect("finalize job");

        let deltas = deltas.lock_unpoisoned();
        assert!(
            deltas.len() >= 2,
            "completion should emit a completed phase delta and a terminal job delta"
        );
        let delta = deltas
            .last()
            .expect("completion should emit a terminal queue-lite delta");
        assert_eq!(delta.base_snapshot_revision, 0);
        assert!(delta.delta_revision >= 1);
        let patch = delta
            .patches
            .iter()
            .find(|patch| patch.id == job_id)
            .expect("completion delta should include finalized job");
        assert_eq!(patch.status, Some(JobStatus::Completed));
        assert_eq!(patch.progress, Some(100.0));
        assert!(patch.elapsed_ms.is_some());
        assert_eq!(
            patch
                .telemetry
                .as_ref()
                .and_then(|telemetry| telemetry.phase.progress_phase),
            Some(ProgressPhase::Completed)
        );
    }

    #[test]
    fn finalize_successful_transcode_job_accounts_for_quiet_finalize_wall_time() {
        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = Inner::new(vec![preset], AppSettings::default());
        let job_id = "job-finalize-elapsed".to_string();
        let now_ms = current_time_millis();
        let previous_wall_ms = 11 * 60 * 1000;
        let quiet_finalize_ms = 22 * 60 * 1000;
        {
            let mut job = make_video_job(&job_id, 100);
            job.processing_started_ms = Some(now_ms.saturating_sub(quiet_finalize_ms));
            job.elapsed_ms = Some(previous_wall_ms);
            if let Some(meta) = job.wait_metadata.as_mut() {
                meta.processed_wall_millis = Some(previous_wall_ms);
            }

            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(job_id.clone(), job);
        }

        finalize_successful_transcode_job(
            &inner,
            FinalizeSuccessfulTranscodeJobArgs {
                job_id: &job_id,
                preset_id: "preset-1",
                output_path: &dir.path().join("out.mp4"),
                original_size_bytes: 100 * 1024 * 1024,
                final_output_size_bytes: 50 * 1024 * 1024,
                elapsed: 10.0,
                input_times: None,
            },
        )
        .expect("finalize job");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(&job_id).expect("job present");
        let elapsed_ms = job.elapsed_ms.expect("elapsed_ms should be finalized");
        assert!(
            elapsed_ms >= previous_wall_ms + quiet_finalize_ms,
            "final elapsed should include quiet finalize wall time, got {elapsed_ms}"
        );
        assert!(
            job.log_tail
                .as_deref()
                .is_some_and(|tail| tail.contains("Completed in 1980.")),
            "completion log should use finalized wall-clock elapsed time"
        );
    }

    #[test]
    fn finalize_successful_transcode_job_stops_after_replace_original_failure() {
        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let input = dir.path().join("video.mp4");
        let output = dir.path().join("video.compressed.mp4");
        std::fs::write(&input, b"source").expect("write source");

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = Inner::new(vec![preset], AppSettings::default());
        let job_id = "job-replace-original-finalize-fail".to_string();
        let batch_id = "batch-replace-original-finalize-fail".to_string();
        let deltas = capture_queue_lite_deltas_for_tests(&inner);
        {
            let mut job = make_video_job(&job_id, 100);
            job.source = JobSource::BatchCompress;
            job.batch_id = Some(batch_id.clone());
            job.input_path = Some(input.to_string_lossy().into_owned());
            job.output_path = Some(output.to_string_lossy().into_owned());
            job.output_policy = Some(OutputPolicy::default());

            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(job_id.clone(), job);
            state.batch_compress_batches.insert(
                batch_id.clone(),
                BatchCompressBatch {
                    batch_id: batch_id.clone(),
                    root_path: dir.path().to_string_lossy().into_owned(),
                    replace_original: true,
                    min_image_size_kb: 0,
                    min_audio_size_kb: 0,
                    image_target_format: Default::default(),
                    output_policy: Default::default(),
                    saving_condition_type: crate::ffui_core::domain::SavingConditionType::Ratio,
                    min_saving_ratio: 0.95,
                    min_saving_absolute_mb: 5.0,
                    status: BatchCompressBatchStatus::Running,
                    total_files_scanned: 1,
                    total_candidates: 1,
                    total_processed: 0,
                    child_job_ids: vec![job_id.clone()],
                processed_child_job_ids: Default::default(),
                    started_at_ms: 1,
                    completed_at_ms: None,
                },
            );
        }

        finalize_successful_transcode_job(
            &inner,
            FinalizeSuccessfulTranscodeJobArgs {
                job_id: &job_id,
                preset_id: "preset-1",
                output_path: &output,
                original_size_bytes: 100 * 1024 * 1024,
                final_output_size_bytes: 50 * 1024 * 1024,
                elapsed: 10.0,
                input_times: None,
            },
        )
        .expect("finalize should short-circuit replacement failure");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(&job_id).expect("job present");
        assert_eq!(job.status, JobStatus::Failed);
        assert_eq!(job.progress, 100.0);
        assert!(
            job.failure_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("failed to rename output")),
            "replacement failure should remain visible on the job"
        );
        assert!(
            !job.logs
                .iter()
                .any(|line| line.text.contains("Completed in")),
            "failed replacement must not append success completion log"
        );
        let preset = state
            .presets
            .iter()
            .find(|preset| preset.id == "preset-1")
            .expect("preset present");
        assert_eq!(preset.stats.usage_count, 0);
        assert!(
            !state
                .progress_phase_by_job
                .get(&job_id)
                .is_some_and(|phase| phase.progress_phase == Some(ProgressPhase::Completed)),
            "failed replacement must not emit a completed phase"
        );
        let batch = state
            .batch_compress_batches
            .get(&batch_id)
            .expect("batch present");
        assert_eq!(batch.total_processed, 1);
        assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
        drop(state);

        let deltas = deltas.lock_unpoisoned();
        let terminal_delta = deltas
            .iter()
            .find(|delta| {
                delta
                    .patches
                    .iter()
                    .any(|patch| patch.id == job_id && patch.status == Some(JobStatus::Failed))
            })
            .expect("replacement failure should emit failed terminal delta");
        assert!(
            terminal_delta.patches.iter().any(|patch| {
                patch.id == job_id
                    && patch
                        .telemetry
                        .as_ref()
                        .and_then(|telemetry| telemetry.phase.progress_phase)
                        != Some(ProgressPhase::Completed)
            }),
            "failed terminal delta must not advertise completed phase"
        );
    }

    #[test]
    fn finalize_successful_restored_batch_video_uses_persisted_replace_original() {
        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let input = dir.path().join("video.mp4");
        let output = dir.path().join("video.compressed.mp4");
        std::fs::write(&input, b"source").expect("write source");
        std::fs::write(&output, b"compressed").expect("write compressed output");

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = Inner::new(vec![preset], AppSettings::default());
        let job_id = "job-restored-replace-original".to_string();
        {
            let mut job = make_video_job(&job_id, 100);
            job.source = JobSource::BatchCompress;
            job.batch_id = Some("restored-batch-without-runtime-meta".to_string());
            job.input_path = Some(input.to_string_lossy().into_owned());
            job.output_path = Some(output.to_string_lossy().into_owned());
            job.output_policy = Some(OutputPolicy::default());
            job.batch_compress_saving_condition = Some(BatchCompressSavingCondition {
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                min_image_size_kb: Some(0),
                min_audio_size_kb: Some(0),
                image_target_format: Some(ImageTargetFormat::Avif),
                replace_original: Some(true),
            });

            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(job_id.clone(), job);
        }

        finalize_successful_transcode_job(
            &inner,
            FinalizeSuccessfulTranscodeJobArgs {
                job_id: &job_id,
                preset_id: "preset-1",
                output_path: &output,
                original_size_bytes: 100 * 1024 * 1024,
                final_output_size_bytes: 50 * 1024 * 1024,
                elapsed: 10.0,
                input_times: None,
            },
        )
        .expect("finalize restored batch video");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(&job_id).expect("job present");
        assert_eq!(job.status, JobStatus::Completed);
        assert_eq!(job.output_path.as_deref(), Some(input.to_string_lossy().as_ref()));
        drop(state);

        assert_eq!(
            std::fs::read(&input).expect("read finalized input"),
            b"compressed"
        );
        assert!(
            !output.exists(),
            "replace-original finalize should consume the staged .compressed output"
        );
    }

    #[test]
    fn preset_stats_persistence_does_not_lose_updates_when_jobs_finish_concurrently() {
        use std::time::Duration;

        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = std::sync::Arc::new(Inner::new(vec![preset], AppSettings::default()));

        let job_id_1 = "job-preset-stats-1".to_string();
        let job_id_2 = "job-preset-stats-2".to_string();
        {
            let mut state = inner.state.lock_unpoisoned();
            state
                .jobs
                .insert(job_id_1.clone(), make_video_job(&job_id_1, 100));
            state
                .jobs
                .insert(job_id_2.clone(), make_video_job(&job_id_2, 200));
        }

        let out_1 = dir.path().join("out-1.mp4");
        let out_2 = dir.path().join("out-2.mp4");

        let presets_path = crate::ffui_core::data_root::presets_path().expect("presets path");
        let save_blocker =
            crate::ffui_core::settings::presets::BlockFirstSavePresetsGuard::new(presets_path);

        let inner_a = inner.clone();
        let job_id_1_a = job_id_1.clone();
        let out_1_a = out_1.clone();
        let t1 = std::thread::spawn(move || {
            finalize_successful_transcode_job(
                inner_a.as_ref(),
                FinalizeSuccessfulTranscodeJobArgs {
                    job_id: &job_id_1_a,
                    preset_id: "preset-1",
                    output_path: &out_1_a,
                    original_size_bytes: 100 * 1024 * 1024,
                    final_output_size_bytes: 50 * 1024 * 1024,
                    elapsed: 10.0,
                    input_times: None,
                },
            )
            .expect("finalize job 1");
        });

        assert!(
            save_blocker.wait_first_entered(Duration::from_secs(2)),
            "expected first presets save to enter blocking section"
        );

        let inner_b = inner.clone();
        let job_id_2_b = job_id_2.clone();
        let out_2_b = out_2.clone();
        let t2 = std::thread::spawn(move || {
            finalize_successful_transcode_job(
                inner_b.as_ref(),
                FinalizeSuccessfulTranscodeJobArgs {
                    job_id: &job_id_2_b,
                    preset_id: "preset-1",
                    output_path: &out_2_b,
                    original_size_bytes: 200 * 1024 * 1024,
                    final_output_size_bytes: 120 * 1024 * 1024,
                    elapsed: 20.0,
                    input_times: None,
                },
            )
            .expect("finalize job 2");
        });

        // In the buggy implementation, job 2 can persist an updated snapshot while job 1 is
        // blocked, then job 1 overwrites the file with a stale snapshot. The fixed
        // implementation keeps persistence under the engine state lock so this second save
        // cannot happen until job 1 unblocks.
        let _second_save_seen =
            save_blocker.wait_call_count_at_least(2, Duration::from_secs(5));

        save_blocker.unblock_first();

        t1.join().expect("thread 1 join");
        t2.join().expect("thread 2 join");

        let loaded = crate::ffui_core::settings::load_presets().expect("load presets");
        let preset = loaded
            .iter()
            .find(|p| p.id == "preset-1")
            .expect("preset-1 present");

        assert_eq!(preset.stats.usage_count, 2);
        assert!((preset.stats.total_input_size_mb - 300.0).abs() < f64::EPSILON);
        assert!((preset.stats.total_output_size_mb - 170.0).abs() < f64::EPSILON);
        // `total_time_seconds` is accumulated as wall-clock "preset active" time,
        // so this finalize-only test (which does not drive worker start/stop
        // transitions) should not change it.
        assert!((preset.stats.total_time_seconds - 0.0).abs() < f64::EPSILON);
        assert!((preset.stats.total_frames - 300.0).abs() < f64::EPSILON);
    }
}
