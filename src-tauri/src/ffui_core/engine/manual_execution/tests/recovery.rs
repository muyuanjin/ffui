use super::*;
use crate::ffui_core::engine::state::EngineState;
use crate::ffui_core::{JobSource, JobStatus};
use crate::test_support::{make_ffmpeg_preset_for_tests, make_transcode_job_for_tests};

#[test]
fn legacy_hydration_refuses_unavailable_default_policy_and_keeps_job_policy_authoritative() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../tests/manual-recovery-capability-contract.json"
    ))
    .expect("contract");
    let preset = make_ffmpeg_preset_for_tests("preset-1");
    let mut state = EngineState::new(vec![preset], Default::default());
    state.unavailable_settings =
        vec![serde_json::from_value(contract["unavailable"].clone()).expect("unavailable setting")];
    let mut job = make_transcode_job_for_tests("legacy", JobStatus::Queued, 0.0, None);
    job.source = JobSource::Manual;
    job.filename = "legacy.mp4".into();
    job.preset_id = "preset-1".into();
    job.execution = None;
    job.output_policy = None;
    hydrate_legacy_job_snapshot(&mut job, &state);
    assert_eq!(
        serde_json::to_value(&job.execution).expect("execution"),
        contract["invalidExecution"]
    );
    assert!(job.output_policy.is_none());
    assert!(
        job.failure_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("/queueOutputPolicy/container"))
    );
    assert_eq!(
        serde_json::to_value(job.execution.as_ref().expect("invalid").mode()).expect("mode"),
        contract["executionMode"]
    );

    let mut valid = make_transcode_job_for_tests("valid-policy", JobStatus::Queued, 0.0, None);
    valid.source = JobSource::Manual;
    valid.filename = "valid.mp4".into();
    valid.preset_id = "preset-1".into();
    valid.execution = None;
    valid.output_policy = Some(OutputPolicy::default());
    hydrate_legacy_job_snapshot(&mut valid, &state);
    assert!(matches!(valid.execution, Some(JobExecution::Video { .. })));
    let saved = serde_json::to_value(&valid.execution).expect("snapshot");
    state.presets = std::sync::Arc::new(Vec::new());
    hydrate_legacy_job_snapshot(&mut valid, &state);
    assert_eq!(
        serde_json::to_value(&valid.execution).expect("snapshot"),
        saved
    );
}
