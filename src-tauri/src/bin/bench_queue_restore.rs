use std::path::PathBuf;

fn parse_arg_path(name: &str) -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next().map(PathBuf::from);
        }
    }
    None
}

fn parse_arg_usize(name: &str, default: usize) -> usize {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == name
            && let Some(value) = args.next()
            && let Ok(parsed) = value.parse::<usize>()
        {
            return parsed;
        }
    }
    default
}

fn median_ms(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if values.is_empty() {
        return 0.0;
    }
    let mid = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    }
}

#[cfg(feature = "bench")]
fn main() -> anyhow::Result<()> {
    let Some(path) = parse_arg_path("--path") else {
        eprintln!(
            "usage: cargo run --release --features bench --bin bench_queue_restore -- --path <queue-state.json> [--repeat N]"
        );
        std::process::exit(2);
    };
    let repeat = parse_arg_usize("--repeat", 5).max(1);

    let report = ffui_lib::bench::bench_restore_queue_state_file(&path, repeat)?;
    println!("[bench] queue restore: path={}", report.path);

    let mut read_ms: Vec<f64> = Vec::new();
    let mut decode_ms: Vec<f64> = Vec::new();
    let mut restore_ms: Vec<f64> = Vec::new();
    let mut resume_ms: Vec<f64> = Vec::new();
    let mut total_ms: Vec<f64> = Vec::new();
    for (i, run) in report.runs.iter().enumerate() {
        let r = run.read_time.as_secs_f64() * 1000.0;
        let d = run.decode_time.as_secs_f64() * 1000.0;
        let s = run.restore_time.as_secs_f64() * 1000.0;
        let re = run.resume_time.as_secs_f64() * 1000.0;
        let t = r + d + s;
        read_ms.push(r);
        decode_ms.push(d);
        restore_ms.push(s);
        resume_ms.push(re);
        total_ms.push(t);
        println!(
            "[bench] run#{i}: bytes={} jobs={} startup(read+decode+restore)={:.2}ms read={:.2}ms decode={:.2}ms restore={:.2}ms restore_segment_dir_scans={} jobs_with_wait_metadata={} resume={:.2}ms resume_resumed_jobs={} resume_segment_dir_scans={} jobs_with_wait_metadata_after_resume={}",
            run.file_bytes,
            run.jobs,
            t,
            r,
            d,
            s,
            run.restore_segment_dir_scans,
            run.jobs_with_wait_metadata,
            re,
            run.resume_resumed_jobs,
            run.resume_segment_dir_scans,
            run.jobs_with_wait_metadata_after_resume,
        );
    }

    println!(
        "[bench] median: startup(read+decode+restore)={:.2}ms read={:.2}ms decode={:.2}ms restore={:.2}ms resume={:.2}ms",
        median_ms(total_ms.clone()),
        median_ms(read_ms),
        median_ms(decode_ms),
        median_ms(restore_ms),
        median_ms(resume_ms),
    );

    Ok(())
}

#[cfg(not(feature = "bench"))]
fn main() {
    eprintln!(
        "bench feature not enabled; run with: cargo run --release --features bench --bin bench_queue_restore -- --path <queue-state.json>"
    );
    std::process::exit(2);
}
