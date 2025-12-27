use std::time::Instant;

use ffui_lib::{
    JobSource, JobStatus, JobType, QueueStateLite, QueueStateLiteDelta, TranscodeJobLite,
    TranscodeJobLiteDeltaPatch,
};

fn parse_arg_u64(name: &str, default: u64) -> u64 {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name
            && let Some(value) = args.next()
            && let Ok(parsed) = value.parse::<u64>()
        {
            return parsed;
        }
    }
    default
}

fn make_job(i: u64, status: JobStatus) -> TranscodeJobLite {
    let id = format!("job-{i}");
    let filename = format!("C:/videos/big-queue/{i:06}-example-long-filename.mp4");
    let output_path = format!("C:/videos/out/{id}.compressed.mp4");
    let input_path = filename.clone();
    let log_tail = Some(String::new());

    TranscodeJobLite {
        id,
        filename,
        job_type: JobType::Video,
        source: if i.is_multiple_of(3) {
            JobSource::BatchCompress
        } else {
            JobSource::Manual
        },
        queue_order: Some(i),
        original_size_mb: 120.0 + (i % 900) as f64,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status,
        progress: 0.0,
        start_time: None,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        input_path: Some(input_path),
        output_path: Some(output_path),
        output_policy: None,
        ffmpeg_command: None,
        first_run_command: None,
        first_run_started_at_ms: None,
        skip_reason: None,
        media_info: None,
        estimated_seconds: Some(120.0 + (i % 600) as f64),
        preview_path: Some(format!("C:/ffui/previews/{i}.jpg")),
        preview_revision: 1,
        log_tail,
        log_head: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: None,
        wait_metadata: None,
    }
}

fn main() {
    let jobs_count = parse_arg_u64("--jobs", 10_000) as usize;
    let baseline_ticks = parse_arg_u64("--baseline-ticks", 10);
    let delta_ticks = parse_arg_u64("--delta-ticks", 5_000);
    let patches_per_tick = parse_arg_u64("--patches", 1) as usize;

    let mut jobs = Vec::with_capacity(jobs_count);
    for i in 0..jobs_count as u64 {
        let status = if i == 0 {
            JobStatus::Processing
        } else {
            JobStatus::Queued
        };
        jobs.push(make_job(i, status));
    }

    // Warm up snapshot serialization once.
    let warm_snapshot = QueueStateLite {
        snapshot_revision: 1,
        jobs: jobs.clone(),
    };
    let _ = serde_json::to_vec(&warm_snapshot).expect("serialize warm snapshot");

    // Baseline: each tick builds a full snapshot (clone all jobs) and serializes it.
    let mut baseline_total_ns: u128 = 0;
    let mut baseline_size_bytes = 0usize;
    for tick in 0..baseline_ticks {
        let snapshot = QueueStateLite {
            snapshot_revision: 2 + tick,
            jobs: jobs.clone(),
        };
        let started = Instant::now();
        let bytes = serde_json::to_vec(&snapshot).expect("serialize snapshot");
        baseline_total_ns += started.elapsed().as_nanos();
        baseline_size_bytes = bytes.len();
    }

    // Delta: each tick builds and serializes only a handful of patches.
    let base_snapshot_revision = 2 + baseline_ticks;
    let mut delta_total_ns: u128 = 0;
    let mut delta_size_bytes = 0usize;
    for tick in 0..delta_ticks {
        let mut patches = Vec::with_capacity(patches_per_tick);
        for p in 0..patches_per_tick {
            let id = format!("job-{p}");
            patches.push(TranscodeJobLiteDeltaPatch {
                id,
                progress: Some(10.0 + (tick as f64) * 0.01),
                elapsed_ms: Some(123_456 + tick),
                preview_path: None,
                preview_revision: None,
            });
        }
        let delta = QueueStateLiteDelta {
            base_snapshot_revision,
            delta_revision: tick + 1,
            patches,
        };
        let started = Instant::now();
        let bytes = serde_json::to_vec(&delta).expect("serialize delta");
        delta_total_ns += started.elapsed().as_nanos();
        delta_size_bytes = bytes.len();
    }

    let baseline_avg_ns = (baseline_total_ns as f64) / (baseline_ticks as f64);
    let delta_avg_ns = (delta_total_ns as f64) / (delta_ticks as f64);
    let baseline_avg_ms = baseline_avg_ns / 1_000_000.0;
    let delta_avg_us = delta_avg_ns / 1_000.0;

    println!(
        "[bench] queue-state-lite vs delta (jobs={jobs_count}, patches/tick={patches_per_tick})"
    );
    println!(
        "[bench] baseline snapshot: ticks={baseline_ticks} avg={baseline_avg_ms:.3}ms size={baseline_size_bytes} bytes"
    );
    println!(
        "[bench] delta: ticks={delta_ticks} avg={delta_avg_us:.3}us size={delta_size_bytes} bytes (baseSnapshotRevision={base_snapshot_revision})"
    );
    println!(
        "[bench] ratio: snapshot_bytes/delta_bytes={:.1}x snapshot_ms/delta_ms={:.1}x",
        (baseline_size_bytes as f64) / (delta_size_bytes as f64),
        (baseline_avg_ms) / ((delta_avg_us / 1000.0).max(1e-12))
    );
    println!(
        "[bench] run: cargo run --release --bin bench_queue_state_lite -- --jobs {jobs_count} --baseline-ticks {baseline_ticks} --delta-ticks {delta_ticks} --patches {patches_per_tick}"
    );
}
