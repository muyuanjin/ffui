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

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct FfmpegProgressSample {
    pub(crate) elapsed_seconds: Option<f64>,
    pub(crate) speed: Option<f64>,
    pub(crate) frame: Option<u64>,
}

pub(crate) fn parse_ffmpeg_progress_sample(line: &str) -> FfmpegProgressSample {
    let mut sample = FfmpegProgressSample::default();
    let mut iter = line.split_whitespace().peekable();
    let first_key = iter
        .peek()
        .and_then(|token| token.split_once('=').map(|(key, _)| key));
    if !matches!(
        first_key,
        Some("frame" | "size" | "Lsize" | "out_time" | "out_time_ms" | "out_time_us" | "speed")
    ) {
        return sample;
    }

    while let Some(token) = iter.next() {
        let (key, value) = match token.split_once('=') {
            Some((k, v)) if !v.is_empty() => (k, v),
            Some((k, _)) => {
                let Some(next) = iter.peek().copied() else {
                    continue;
                };
                // Consume the value token when we handled a "key=" token form.
                let _ = iter.next();
                (k, next)
            }
            None => continue,
        };

        match key {
            "time" | "out_time" => {
                sample.elapsed_seconds =
                    parse_ffmpeg_time_to_seconds(value).or(sample.elapsed_seconds);
            }
            "out_time_ms" | "out_time_us" => {
                if let Ok(us) = value.parse::<f64>()
                    && us.is_finite()
                    && us >= 0.0
                {
                    sample.elapsed_seconds = Some(us / 1_000_000.0);
                }
            }
            "speed" => {
                let value = value.trim_end_matches('x');
                if let Ok(v) = value.parse::<f64>() {
                    sample.speed = Some(v);
                }
            }
            "frame" => {
                if let Ok(v) = value.parse::<u64>() {
                    sample.frame = Some(v);
                }
            }
            _ => {}
        }
    }

    sample
}

pub(crate) fn parse_ffmpeg_progress_line(line: &str) -> Option<(f64, Option<f64>)> {
    let sample = parse_ffmpeg_progress_sample(line);
    sample
        .elapsed_seconds
        .map(|elapsed| (elapsed, sample.speed))
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

pub(crate) fn parse_ffmpeg_time_to_seconds(value: &str) -> Option<f64> {
    if value.starts_with('-') {
        return None;
    }
    let seconds = if value.contains(':') {
        let mut parts = value.split(':');
        let hours = parts.next()?.parse::<u32>().ok()?;
        let minutes = parts.next()?.parse::<u32>().ok()?;
        let seconds = parts.next()?.parse::<f64>().ok()?;
        if parts.next().is_some() || minutes >= 60 || !(0.0..60.0).contains(&seconds) {
            return None;
        }
        f64::from(hours).mul_add(3600.0, f64::from(minutes) * 60.0) + seconds
    } else {
        value.parse::<f64>().ok()?
    };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds)
}

pub(crate) fn parse_ffmpeg_duration_from_metadata_line(line: &str) -> Option<f64> {
    let idx = line.find("Duration:")?;
    let rest = &line[idx + "Duration:".len()..];
    let time_str = rest.trim().split(',').next().unwrap_or("").trim();
    if time_str.is_empty() {
        return None;
    }
    let seconds = parse_ffmpeg_time_to_seconds(time_str)?;
    if seconds > 0.0 { Some(seconds) } else { None }
}
