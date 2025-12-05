// Progress calculation and parsing helpers for ffmpeg/ffprobe output.

pub(crate) fn compute_progress_percent(total_duration: Option<f64>, elapsed_seconds: f64) -> f64 {
    match total_duration {
        Some(total) if total.is_finite() && total > 0.0 => {
            let elapsed = if elapsed_seconds.is_finite() && elapsed_seconds > 0.0 {
                elapsed_seconds
            } else {
                0.0
            };
            let ratio = elapsed / total;
            let value = (ratio * 100.0).clamp(0.0, 100.0);
            if value.is_finite() { value } else { 0.0 }
        }
        _ => 0.0,
    }
}

pub(crate) fn parse_ffmpeg_progress_line(line: &str) -> Option<(f64, Option<f64>)> {
    let mut elapsed: Option<f64> = None;
    let mut speed: Option<f64> = None;

    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix("time=") {
            elapsed = Some(parse_ffmpeg_time_to_seconds(rest));
        } else if let Some(rest) = token.strip_prefix("out_time=") {
            elapsed = Some(parse_ffmpeg_time_to_seconds(rest));
        } else if let Some(rest) = token.strip_prefix("out_time_ms=") {
            if let Ok(us) = rest.parse::<f64>() {
                elapsed = Some(us / 1_000_000.0);
            }
        } else if let Some(rest) = token.strip_prefix("speed=") {
            let value = rest.trim_end_matches('x');
            if let Ok(v) = value.parse::<f64>() {
                speed = Some(v);
            }
        }
    }

    elapsed.map(|e| (e, speed))
}

pub(crate) fn is_ffmpeg_progress_end(line: &str) -> bool {
    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix("progress=")
            && rest.eq_ignore_ascii_case("end")
        {
            return true;
        }
    }
    false
}

pub(crate) fn parse_ffmpeg_time_to_seconds(s: &str) -> f64 {
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() == 3 {
            let h = parts[0].parse::<f64>().unwrap_or(0.0);
            let m = parts[1].parse::<f64>().unwrap_or(0.0);
            let sec = parts[2].parse::<f64>().unwrap_or(0.0);
            return h * 3600.0 + m * 60.0 + sec;
        }
    }
    s.parse::<f64>().unwrap_or(0.0)
}

pub(crate) fn parse_ffmpeg_duration_from_metadata_line(line: &str) -> Option<f64> {
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let time_str = rest.trim().split(',').next().unwrap_or("").trim();
    if time_str.is_empty() {
        return None;
    }
    let seconds = parse_ffmpeg_time_to_seconds(time_str);
    if seconds > 0.0 { Some(seconds) } else { None }
}
