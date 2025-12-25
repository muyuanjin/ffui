/// Tokenize an ffmpeg template string into argv-like arguments, honoring simple
/// single-quote and double-quote grouping.
///
/// This is intentionally conservative and avoids shell-specific expansions; it
/// exists so advanced preset templates can be executed safely via
/// `Command::new(ffmpeg_path).args(args)`.
pub(crate) fn split_template_args(template: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;

    let mut chars = template.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            '\\' if in_double => {
                // Minimal escape handling for `\"` inside double quotes.
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            other => current.push(other),
        }
    }

    if !current.is_empty() {
        args.push(current);
    }

    args
}

pub(crate) fn strip_leading_ffmpeg_program(args: &mut Vec<String>) {
    let Some(first) = args.first() else {
        return;
    };

    let lower = first.to_lowercase();
    let base = lower.rsplit(['/', '\\']).next().unwrap_or(lower.as_str());
    if base == "ffmpeg" || base == "ffmpeg.exe" {
        args.remove(0);
    }
}
