use super::*;
use crate::ffui_core::engine::segment_discovery;
use crate::ffui_core::engine::state::restore_segment_probe::SegmentDirCache;

#[test]
fn crash_recovery_recovers_wait_metadata_segments_from_output_directory_on_job_start() {
    let engine = make_engine_with_preset();
    let dir = tempfile::tempdir().expect("temp dir");

    let job_id = "job-1766587734267";
    let output_path = dir.path().join("FC2-2319995-20251224-224859.mkv");
    let seg0 = dir
        .path()
        .join(format!("FC2-2319995-20251224-224859.{job_id}.seg0.tmp.mkv"));
    let seg1 = dir
        .path()
        .join(format!("FC2-2319995-20251224-224859.{job_id}.seg1.tmp.mkv"));

    std::fs::write(&seg0, b"seg0").expect("write seg0");
    std::fs::write(&seg1, b"seg1").expect("write seg1");

    let mut job =
        crate::test_support::make_transcode_job_for_tests(job_id, JobStatus::Paused, 12.0, Some(1));
    job.filename = dir
        .path()
        .join("FC2-2319995-20251224-224859.mp4")
        .to_string_lossy()
        .into_owned();
    job.output_path = Some(output_path.to_string_lossy().into_owned());
    job.elapsed_ms = Some(4321);
    job.wait_metadata = None;

    restore_jobs_from_snapshot(&engine.inner, QueueState { jobs: vec![job] });

    assert!(engine.resume_job(job_id), "resume should succeed");

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let picked = next_job_for_worker_locked(&mut state).expect("job must be selectable");
        assert_eq!(picked, job_id, "expected the resumed job to be selected");
    }

    segment_discovery::reset_list_segment_candidates_calls_for_tests();
    let mut cache = SegmentDirCache::default();
    probe_crash_recovery_wait_metadata_for_processing_job_best_effort(
        &engine.inner,
        job_id,
        &mut cache,
    );
    assert_eq!(
        segment_discovery::list_segment_candidates_calls_for_tests(),
        1,
        "expected exactly one directory scan to recover segments from output dir"
    );

    let state = engine.inner.state.lock_unpoisoned();
    let restored = state.jobs.get(job_id).expect("restored job exists");
    let meta = restored
        .wait_metadata
        .as_ref()
        .expect("wait_metadata should be recovered from filesystem");
    let seg0_str = seg0.to_string_lossy().into_owned();
    let seg1_str = seg1.to_string_lossy().into_owned();
    assert_eq!(
        meta.segments.as_deref(),
        Some(&[seg0_str, seg1_str.clone()][..]),
        "recovered segments should match output-based segN.tmp naming"
    );
    assert_eq!(
        meta.tmp_output_path.as_deref(),
        Some(seg1_str.as_str()),
        "tmp_output_path should point to the last recovered segment"
    );
}

#[test]
fn resume_job_is_idempotent_for_waiting_jobs() {
    let engine = make_engine_with_preset();
    let job_id = "job-1";

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let job = crate::test_support::make_transcode_job_for_tests(
            job_id,
            JobStatus::Queued,
            0.0,
            Some(1),
        );
        state.jobs.insert(job_id.to_string(), job);
        state.queue.clear();
    }

    assert!(
        engine.resume_job(job_id),
        "resume should succeed for waiting job"
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.queue.iter().any(|id| id == job_id),
        "resume should ensure waiting job is present in the queue"
    );
}
