use std::time::Instant;

use ffui_lib::{
    JobSource, JobStatus, JobType, QueueStateLiteDelta, QueueStateUiLite,
    TaskbarProgressDeltaTracker, TaskbarProgressMode, TaskbarProgressScope,
    TranscodeJobLiteDeltaPatch, TranscodeJobUiLite,
};

fn take_value(args: &[String], idx: usize, flag: &str) -> String {
    let Some(value) = args.get(idx + 1) else {
        panic!("missing value for {flag}");
    };
    if value.starts_with("--") {
        panic!("missing value for {flag}");
    }
    value.clone()
}

fn parse_u64(args: &[String], flag: &str, default: u64) -> u64 {
    for i in 0..args.len() {
        if args[i] == flag {
            let raw = take_value(args, i, flag);
            return raw.parse::<u64>().unwrap_or(default);
        }
    }
    default
}

fn parse_jobs_list(args: &[String]) -> Vec<usize> {
    for i in 0..args.len() {
        if args[i] == "--jobs-list" {
            let raw = take_value(args, i, "--jobs-list");
            return raw
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.parse::<usize>().expect("jobs-list entry must be integer"))
                .collect();
        }
    }
    vec![parse_u64(args, "--jobs", 10_000) as usize]
}

fn parse_mode(args: &[String]) -> TaskbarProgressMode {
    for i in 0..args.len() {
        if args[i] == "--mode" {
            let raw = take_value(args, i, "--mode").to_ascii_lowercase();
            return match raw.as_str() {
                "by_size" | "size" => TaskbarProgressMode::BySize,
                "by_duration" | "duration" => TaskbarProgressMode::ByDuration,
                "by_estimated_time" | "estimated" | "estimated_time" => {
                    TaskbarProgressMode::ByEstimatedTime
                }
                other => panic!("unknown --mode: {other}"),
            };
        }
    }
    TaskbarProgressMode::BySize
}

fn parse_scope(args: &[String]) -> TaskbarProgressScope {
    for i in 0..args.len() {
        if args[i] == "--scope" {
            let raw = take_value(args, i, "--scope").to_ascii_lowercase();
            return match raw.as_str() {
                "all" | "all_jobs" => TaskbarProgressScope::AllJobs,
                "active" | "active_and_queued" => TaskbarProgressScope::ActiveAndQueued,
                other => panic!("unknown --scope: {other}"),
            };
        }
    }
    TaskbarProgressScope::AllJobs
}

fn make_job(i: usize, status: JobStatus, progress: f64) -> TranscodeJobUiLite {
    let id = format!("job-{i:06}");
    TranscodeJobUiLite {
        id: id.clone(),
        filename: format!("C:/videos/big-queue/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: Some(i as u64),
        original_size_mb: 120.0 + (i % 900) as f64,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status,
        progress,
        start_time: Some(1),
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        input_path: None,
        created_time_ms: None,
        modified_time_ms: None,
        output_path: None,
        output_policy: None,
        ffmpeg_command: None,
        first_run_command: None,
        first_run_started_at_ms: None,
        skip_reason: None,
        media_info: None,
        estimated_seconds: Some(120.0 + (i % 600) as f64),
        preview_path: None,
        preview_revision: 0,
        log_tail: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: None,
        wait_metadata: None,
    }
}

fn make_progress_patch(id: &str, progress: f64) -> TranscodeJobLiteDeltaPatch {
    TranscodeJobLiteDeltaPatch {
        id: id.to_string(),
        status: None,
        progress: Some(progress),
        progress_out_time_seconds: None,
        progress_speed: None,
        progress_updated_at_ms: None,
        progress_epoch: None,
        elapsed_ms: None,
        preview_path: None,
        preview_revision: None,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!(
            "Usage:\n  cargo run --features bench --bin bench_taskbar_progress_delta -- [options]\n\nOptions:\n  --jobs <N>              Total jobs (default: 10000)\n  --jobs-list <CSV>       Jobs list, e.g. 1000,10000,100000\n  --processing-jobs <N>   Jobs patched per tick (default: 2)\n  --ticks <N>             Delta ticks to run (default: 5000)\n  --mode <M>              size|duration|estimated (default: size)\n  --scope <S>             all|active (default: all)\n"
        );
        return;
    }

    let jobs_list = parse_jobs_list(&args);
    let processing_jobs = parse_u64(&args, "--processing-jobs", 2) as usize;
    let ticks = parse_u64(&args, "--ticks", 5_000) as u64;
    let mode = parse_mode(&args);
    let scope = parse_scope(&args);

    println!("[bench] taskbar delta tracker (mode={mode:?} scope={scope:?})");
    println!("[bench] config: processing_jobs={processing_jobs} ticks={ticks}");

    for jobs_count in jobs_list {
        let mut jobs = Vec::with_capacity(jobs_count);
        for i in 0..jobs_count {
            let status = if i < processing_jobs {
                JobStatus::Processing
            } else {
                JobStatus::Queued
            };
            let progress = if status == JobStatus::Processing {
                10.0
            } else {
                0.0
            };
            jobs.push(make_job(i, status, progress));
        }

        let snapshot = QueueStateUiLite {
            snapshot_revision: 1,
            jobs,
        };

        let mut tracker = TaskbarProgressDeltaTracker::default();
        tracker.reset_from_ui_lite(&snapshot, mode, scope);

        let mut delta_total_ns: u128 = 0;
        for tick in 0..ticks {
            let mut patches = Vec::with_capacity(processing_jobs);
            for i in 0..processing_jobs {
                let id = format!("job-{i:06}");
                let next = ((tick as f64) * 0.01 + 10.0).min(99.9);
                patches.push(make_progress_patch(&id, next));
            }

            let delta = QueueStateLiteDelta {
                base_snapshot_revision: 1,
                delta_revision: tick + 1,
                patches,
            };

            let started = Instant::now();
            tracker.apply_delta(&delta, mode, scope);
            delta_total_ns += started.elapsed().as_nanos();
        }

        let avg_ns = (delta_total_ns as f64) / (ticks as f64);
        let avg_us = avg_ns / 1000.0;
        let p = tracker.progress().unwrap_or(0.0);
        println!("[bench] jobs={jobs_count} avg_apply_delta={avg_us:.3}us final_progress≈{p:.4}");
    }

    println!(
        "[bench] run:\n  cargo run --features bench --bin bench_taskbar_progress_delta -- --jobs-list 1000,10000,100000 --processing-jobs 2 --ticks 5000 --mode size --scope all"
    );
}
