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
        fs::write(&path, json).expect("mock ffmpeg must write capture file");
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

    if env::var("FFUI_MOCK_FFMPEG_EMIT_PROGRESS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        eprintln!("out_time_ms=0");
        eprintln!("progress=continue");
        eprintln!("out_time_ms=1000");
        eprintln!("progress=end");
    }

    let exit_code: i32 = env::var("FFUI_MOCK_FFMPEG_EXIT_CODE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    std::process::exit(exit_code);
}
