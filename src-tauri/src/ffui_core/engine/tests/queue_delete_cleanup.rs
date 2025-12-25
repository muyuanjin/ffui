use super::*;

#[test]
fn delete_job_cleans_resume_segment_tmp_artifacts() {
    let engine = make_engine_with_preset();
    let dir = tempfile::tempdir().expect("temp dir");

    let job_id = "job-delete-cleanup-1";
    let output_path = dir.path().join("video-out.mkv");
    let seg0 = dir.path().join(format!("video-out.{job_id}.seg0.tmp.mkv"));
    let seg1 = dir.path().join(format!("video-out.{job_id}.seg1.tmp.mkv"));
    let seg2_orphan = dir.path().join(format!("video-out.{job_id}.seg2.tmp.mkv"));

    std::fs::write(&seg0, b"seg0").expect("write seg0");
    std::fs::write(&seg1, b"seg1").expect("write seg1");
    std::fs::write(&seg2_orphan, b"seg2").expect("write seg2");

    let marker0 = seg0.with_extension("noaudio.done");
    std::fs::write(&marker0, b"").expect("write marker");

    let noaudio_tmp1 = seg1.with_extension("noaudio.tmp.mkv");
    std::fs::write(&noaudio_tmp1, b"tmp").expect("write noaudio tmp");

    let concat_list = output_path.with_extension("concat.list");
    std::fs::write(&concat_list, b"file 'x'\n").expect("write concat list");
    let joined_video_tmp = output_path.with_extension("video.concat.tmp.mkv");
    std::fs::write(&joined_video_tmp, b"joined").expect("write joined tmp");
    let mux_tmp = output_path.with_extension("concat.tmp.mkv");
    std::fs::write(&mux_tmp, b"mux").expect("write mux tmp");

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut job = crate::test_support::make_transcode_job_for_tests(
            job_id,
            JobStatus::Completed,
            100.0,
            Some(1),
        );
        job.filename = dir.path().join("in.mp4").to_string_lossy().into_owned();
        job.output_path = Some(output_path.to_string_lossy().into_owned());
        job.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(88.0),
            processed_wall_millis: Some(1234),
            processed_seconds: Some(12.0),
            target_seconds: Some(12.0),
            last_progress_out_time_seconds: None,
            last_progress_frame: None,
            tmp_output_path: Some(seg1.to_string_lossy().into_owned()),
            segments: Some(vec![
                seg0.to_string_lossy().into_owned(),
                seg1.to_string_lossy().into_owned(),
            ]),
            segment_end_targets: None,
        });
        state.jobs.insert(job_id.to_string(), job);
    }

    assert!(engine.delete_job(job_id), "job should be deletable");

    assert!(!seg0.exists(), "seg0 should be deleted");
    assert!(!seg1.exists(), "seg1 should be deleted");
    assert!(!seg2_orphan.exists(), "orphan seg2 should be deleted");
    assert!(!marker0.exists(), "marker should be deleted");
    assert!(!noaudio_tmp1.exists(), "noaudio tmp should be deleted");
    assert!(!concat_list.exists(), "concat list should be deleted");
    assert!(!joined_video_tmp.exists(), "joined tmp should be deleted");
    assert!(!mux_tmp.exists(), "mux tmp should be deleted");
}
