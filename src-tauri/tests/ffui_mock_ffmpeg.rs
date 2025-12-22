use std::path::PathBuf;
use std::{
    env,
    fs,
};

use serde::Serialize;

#[derive(Serialize)]
struct CapturePayload {
    argv: Vec<String>,
}

fn main() {
    let argv: Vec<String> = env::args().skip(1).collect();

    if let Ok(capture_path) = env::var("FFUI_MOCK_FFMPEG_CAPTURE_PATH") {
        let path = PathBuf::from(capture_path);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let payload = CapturePayload { argv: argv.clone() };
        let json =
            serde_json::to_string(&payload).expect("mock ffmpeg capture JSON must serialize");
        let append = env::var("FFUI_MOCK_FFMPEG_CAPTURE_APPEND")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if append {
            use std::io::Write as IoWrite;
            let mut f = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .expect("mock ffmpeg must open capture file for append");
            writeln!(f, "{json}").expect("mock ffmpeg must append capture line");
        } else {
            fs::write(&path, json).expect("mock ffmpeg must write capture file");
        }
    }

    // Best-effort behavior to make unit/integration tests self-contained:
    // when acting as ffmpeg (i.e. invoked with `-i ... OUTPUT`), touch the
    // output path so downstream logic that expects the file to exist (rename,
    // marker creation, etc.) can proceed without a real ffmpeg binary.
    // Engine-mode helpers should remain reliable even when other tests enable
    // capture mode concurrently (environment variables are process-global in
    // Rust tests). Therefore, engine-mode flags intentionally do not get
    // disabled by capture mode.
    let touch_output_engine_mode = env::var("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let should_touch_output = touch_output_engine_mode
        || env::var("FFUI_MOCK_FFMPEG_TOUCH_OUTPUT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        || argv.last().map(|p| p.starts_with('/')).unwrap_or(false);
    if should_touch_output
        && argv.iter().any(|a| a == "-i")
        && let Some(last) = argv.last()
        && !last.starts_with('-')
        && !last.starts_with("pipe:")
    {
        let out = PathBuf::from(last);
        if let Some(parent) = out.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&out, b"");
    }

    let mut stdout_payload: Option<String> = None;
    if argv
        .windows(2)
        .any(|w| w[0] == "-show_entries" && w[1].contains("stream=start_time"))
    {
        stdout_payload = env::var("FFUI_MOCK_FFPROBE_STREAM_START_TIME").ok();
    } else if argv
        .windows(2)
        .any(|w| w[0] == "-show_entries" && w[1].contains("format=start_time"))
    {
        stdout_payload = env::var("FFUI_MOCK_FFPROBE_FORMAT_START_TIME").ok();
    }
    if let Some(payload) = stdout_payload {
        print!("{payload}");
    }

    // Pause polling regression tests: simulate an ffmpeg process that emits
    // no progress lines. It waits for stdin 'q' to exit, but also has a
    // deadline so older pause implementations (which only checked pause on
    // stderr line boundaries) do not hang the test suite forever.
    let silent_wait_timeout_ms: Option<u64> =
        env::var("FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok());
    let silent_mode_active = silent_wait_timeout_ms.is_some();
    if let Some(timeout_ms) = silent_wait_timeout_ms {
        use std::io::{
            BufRead,
            BufReader,
        };
        use std::sync::Arc;
        use std::sync::atomic::{
            AtomicBool,
            Ordering,
        };
        use std::thread;
        use std::time::{
            Duration,
            Instant,
        };

        let quit = Arc::new(AtomicBool::new(false));
        let quit_reader = quit.clone();
        thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut reader = BufReader::new(stdin.lock());
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if line.trim().eq_ignore_ascii_case("q") {
                            quit_reader.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        while Instant::now() < deadline && !quit.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
    }

    let emit_engine_progress = env::var("FFUI_MOCK_FFMPEG_ENGINE_PROGRESS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let emit_progress_once = emit_engine_progress
        || env::var("FFUI_MOCK_FFMPEG_EMIT_PROGRESS")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        || env::var("FFUI_MOCK_FFMPEG_EMIT_PROGRESS_ONCE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
    if emit_progress_once && !silent_mode_active {
        eprintln!("out_time_ms=0");
        eprintln!("progress=continue");
        eprintln!("out_time_ms=1000");
        eprintln!("progress=end");
    }

    // Cooperative pause tests: keep emitting progress updates until stdin
    // contains a line with 'q', then exit with a final `progress=end`.
    if !silent_mode_active
        && env::var("FFUI_MOCK_FFMPEG_PROGRESS_UNTIL_Q")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    {
        use std::io::{
            BufRead,
            BufReader,
            Write as IoWrite,
        };
        use std::sync::Arc;
        use std::sync::atomic::{
            AtomicBool,
            Ordering,
        };
        use std::thread;
        use std::time::Duration;

        let quit = Arc::new(AtomicBool::new(false));
        let quit_reader = quit.clone();
        thread::spawn(move || {
            let stdin = std::io::stdin();
            let mut reader = BufReader::new(stdin.lock());
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if line.trim().eq_ignore_ascii_case("q") {
                            quit_reader.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let mut out_time_ms: u64 = 0;
        let mut stderr = std::io::stderr();
        loop {
            if quit.load(Ordering::SeqCst) {
                out_time_ms = out_time_ms.saturating_add(1_000_000);
                let _ = writeln!(stderr, "out_time_ms={out_time_ms}");
                let _ = writeln!(stderr, "progress=end");
                let _ = stderr.flush();
                break;
            }

            out_time_ms = out_time_ms.saturating_add(200_000);
            let _ = writeln!(stderr, "out_time_ms={out_time_ms}");
            let _ = writeln!(stderr, "progress=continue");
            let _ = stderr.flush();
            thread::sleep(Duration::from_millis(10));
        }
    }

    let exit_code: i32 = env::var("FFUI_MOCK_FFMPEG_EXIT_CODE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    std::process::exit(exit_code);
}
