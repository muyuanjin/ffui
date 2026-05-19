#[cfg(test)]
mod two_pass_cleanup_tests {
    use super::*;

    fn write_artifacts(output: &Path) {
        for path in two_pass_artifact_paths(output) {
            fs::write(path, b"passlog").expect("write passlog artifact");
        }
    }

    #[test]
    fn cleanup_two_pass_outputs_after_failed_encode_keeps_resumable_passlog_artifacts() {
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_cleanup_resumable_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let log_output = dir.join("segment0.tmp.mp4");
        let tmp_output = dir.join("segment1.tmp.mp4");
        write_artifacts(&log_output);
        write_artifacts(&tmp_output);

        cleanup_two_pass_outputs_after_failed_encode(&log_output, &tmp_output, true);

        assert!(
            two_pass_artifact_paths(&log_output)
                .into_iter()
                .all(|path| path.exists()),
            "resumable pass-2 failure must keep pass-1 log artifacts"
        );
        assert!(
            two_pass_artifact_paths(&tmp_output)
                .into_iter()
                .all(|path| path.exists()),
            "resumable pass-2 failure must keep current segment passlog artifacts"
        );

        drop(fs::remove_dir_all(dir));
    }

    #[test]
    fn cleanup_two_pass_outputs_after_failed_encode_removes_fresh_passlog_artifacts() {
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_cleanup_fresh_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let tmp_output = dir.join("fresh.tmp.mp4");
        write_artifacts(&tmp_output);

        cleanup_two_pass_outputs_after_failed_encode(&tmp_output, &tmp_output, false);

        assert!(
            two_pass_artifact_paths(&tmp_output)
                .into_iter()
                .all(|path| !path.exists()),
            "fresh two-pass failure should clean passlog artifacts"
        );

        drop(fs::remove_dir_all(dir));
    }

    #[test]
    fn cleanup_two_pass_outputs_removes_low_savings_passlog_artifacts() {
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_cleanup_low_savings_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let tmp_output = dir.join("video.tmp.mp4");
        let log_output = dir.join("video.passlog.mp4");
        let completed_segment = dir.join("video.segment-1.mp4");
        write_artifacts(&tmp_output);
        write_artifacts(&log_output);
        write_artifacts(&completed_segment);

        cleanup_two_pass_outputs(&log_output, &tmp_output, &[completed_segment.clone()]);

        assert!(
            two_pass_artifact_paths(&log_output)
                .into_iter()
                .chain(two_pass_artifact_paths(&tmp_output))
                .chain(two_pass_artifact_paths(&completed_segment))
                .all(|path| !path.exists()),
            "low-savings two-pass skip should clean passlog artifacts"
        );

        drop(fs::remove_dir_all(dir));
    }

    #[test]
    fn cleanup_two_pass_artifacts_removes_all_numbered_stream_passlogs() {
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_cleanup_streams_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let tmp_output = dir.join("multi-stream.tmp.mp4");
        let prefix = format!("{}.ffui2pass", tmp_output.to_string_lossy());
        let extra_artifacts = [
            PathBuf::from(format!("{prefix}-1.log")),
            PathBuf::from(format!("{prefix}-1.log.mbtree")),
            PathBuf::from(format!("{prefix}-2.log")),
            PathBuf::from(format!("{prefix}-2.log.mbtree")),
        ];
        write_artifacts(&tmp_output);
        for path in &extra_artifacts {
            fs::write(path, b"passlog").expect("write extra stream passlog artifact");
        }

        cleanup_two_pass_artifacts(&tmp_output);

        assert!(
            two_pass_artifact_paths(&tmp_output)
                .into_iter()
                .all(|path| !path.exists()),
            "two-pass cleanup should remove every numbered stream passlog"
        );

        drop(fs::remove_dir_all(dir));
    }

    #[test]
    fn elapsed_since_execution_start_counts_prelude_time() {
        let execution_start_time = SystemTime::now()
            .checked_sub(Duration::from_secs(2))
            .expect("time subtraction should succeed");

        let elapsed = elapsed_since_execution_start(execution_start_time);

        assert!(
            elapsed >= 2.0,
            "elapsed should be measured from before the two-pass prelude, got {elapsed}"
        );
    }

    #[test]
    fn rewrite_current_two_pass_log_prefix_uses_active_segment_output() {
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_prefix_current_{}",
            current_time_millis()
        ));
        let previous_segment = dir.join("segment0.tmp.mp4");
        let tmp_output = dir.join("segment1.tmp.mp4");
        let previous_prefix = format!("{}.ffui2pass", previous_segment.to_string_lossy());
        let current_prefix = format!("{}.ffui2pass", tmp_output.to_string_lossy());
        let mut args = vec![
            "-passlogfile".to_string(),
            previous_prefix,
            "-pass".to_string(),
            "2".to_string(),
            tmp_output.to_string_lossy().into_owned(),
        ];

        let log_output = rewrite_current_two_pass_log_prefix(&mut args, &tmp_output);

        assert_eq!(log_output, tmp_output);
        assert_eq!(
            args.windows(2)
                .find(|w| w[0] == "-passlogfile")
                .map(|w| w[1].as_str()),
            Some(current_prefix.as_str()),
            "resumed pass 2 must use the active segment passlog prefix"
        );
    }

    #[test]
    fn handle_two_pass_first_pass_pause_requeues_when_wait_was_cancelled() {
        let inner = Inner::new(Vec::new(), AppSettings::default());
        let job_id = "two-pass-cancelled-wait";
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_cancelled_wait_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let tmp_output = dir.join("segment0.tmp.mp4");
        let output_path = dir.join("output.mp4");
        fs::write(&tmp_output, b"partial").expect("write tmp output");
        write_artifacts(&tmp_output);

        {
            let mut state = inner.state.lock_unpoisoned();
            let mut job = crate::test_support::make_transcode_job_for_tests(
                job_id,
                JobStatus::Processing,
                25.0,
                Some(current_time_millis()),
            );
            job.output_path = Some(output_path.to_string_lossy().into_owned());
            state.jobs.insert(job_id.to_string(), job);
            state.wait_requests.remove(job_id);
        }

        handle_two_pass_first_pass_pause(&inner, job_id, &tmp_output, &output_path)
            .expect("first-pass pause handling should succeed");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should exist");
        assert_eq!(
            job.status,
            JobStatus::Queued,
            "cancelled first-pass pause should auto-queue continuation"
        );
        assert!(
            state.queue.iter().any(|id| id == job_id),
            "cancelled first-pass pause should keep the job in queue order"
        );
        assert!(
            job.wait_metadata.is_some(),
            "first-pass pause should still persist restart metadata before requeue"
        );
        let meta = job
            .wait_metadata
            .as_ref()
            .expect("restart metadata should exist");
        assert_eq!(
            meta.segments, None,
            "fresh first-pass pause must not record the pass 1 output as a completed segment"
        );
        assert!(
            two_pass_artifact_paths(&tmp_output)
                .into_iter()
                .all(|path| !path.exists()),
            "first-pass pause should clean abandoned passlog artifacts"
        );

        drop(fs::remove_dir_all(dir));
    }

    #[test]
    fn two_pass_first_pass_pause_preserves_completed_segments_without_current_output() {
        let inner = Inner::new(Vec::new(), AppSettings::default());
        let job_id = "two-pass-preserve-segments";
        let dir = std::env::temp_dir().join(format!(
            "ffui_two_pass_preserve_segments_{}",
            current_time_millis()
        ));
        fs::create_dir_all(&dir).expect("create test directory");
        let previous_segment = dir.join("segment0.tmp.mp4");
        let tmp_output = dir.join("segment1.tmp.mp4");
        let output_path = dir.join("output.mp4");
        fs::write(&previous_segment, b"encoded").expect("write previous segment");
        fs::write(&tmp_output, b"analysis").expect("write tmp output");
        write_artifacts(&tmp_output);

        {
            let mut state = inner.state.lock_unpoisoned();
            let mut job = crate::test_support::make_transcode_job_for_tests(
                job_id,
                JobStatus::Processing,
                37.0,
                Some(current_time_millis().saturating_sub(250)),
            );
            job.output_path = Some(output_path.to_string_lossy().into_owned());
            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: Some(62.5),
                processed_wall_millis: Some(1_000),
                processed_seconds: Some(5.0),
                target_seconds: Some(5.0),
                progress_epoch: None,
                last_progress_out_time_seconds: Some(5.2),
                last_progress_speed: Some(1.0),
                last_progress_updated_at_ms: Some(current_time_millis()),
                last_progress_frame: Some(150),
                tmp_output_path: Some(tmp_output.to_string_lossy().into_owned()),
                segments: Some(vec![previous_segment.to_string_lossy().into_owned()]),
                segment_end_targets: Some(vec![5.0]),
            });
            state.jobs.insert(job_id.to_string(), job);
            state.wait_requests.insert(job_id.to_string());
        }

        handle_two_pass_first_pass_pause(&inner, job_id, &tmp_output, &output_path)
            .expect("first-pass pause handling should succeed");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should exist");
        assert_eq!(job.status, JobStatus::Paused);
        let meta = job
            .wait_metadata
            .as_ref()
            .expect("restart metadata should exist");
        assert_eq!(
            meta.segments.as_ref(),
            Some(&vec![previous_segment.to_string_lossy().into_owned()]),
            "pass 1 pause must preserve prior completed segments only"
        );
        assert!(
            !meta
                .segments
                .as_ref()
                .unwrap_or(&Vec::new())
                .iter()
                .any(|segment| segment == tmp_output.to_string_lossy().as_ref()),
            "pass 1 analysis output must not be appended to concat segments"
        );
        assert_eq!(meta.segment_end_targets.as_ref(), Some(&vec![5.0]));
        assert_eq!(meta.processed_seconds, Some(5.0));
        assert_eq!(meta.target_seconds, Some(5.0));
        assert_eq!(
            meta.tmp_output_path.as_deref(),
            Some(tmp_output.to_string_lossy().as_ref()),
            "restart metadata should still point at the abandoned current temp path for recovery context"
        );
        assert!(
            !tmp_output.exists(),
            "first-pass pause should delete the abandoned analysis output"
        );
        assert!(
            two_pass_artifact_paths(&tmp_output)
                .into_iter()
                .all(|path| !path.exists()),
            "first-pass pause should clean abandoned passlog artifacts"
        );

        drop(state);
        drop(fs::remove_dir_all(dir));
    }
}
