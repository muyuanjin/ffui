/// Build a human-readable command line for logging, quoting arguments that
/// contain spaces to make it easier to copy/paste for debugging.
pub(crate) fn format_command_for_log(program: &str, args: &[String]) -> String {
    fn quote_arg(arg: &str) -> String {
        if arg.contains(' ') {
            format!("\"{arg}\"")
        } else {
            arg.to_string()
        }
    }

    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_arg(program));
    for arg in args {
        parts.push(quote_arg(arg));
    }
    parts.join(" ")
}

pub(in crate::ffui_core::engine) fn ensure_progress_args(args: &mut Vec<String>) {
    let mut progress_indices: Vec<usize> = args
        .iter()
        .enumerate()
        .filter_map(|(idx, arg)| (arg == "-progress").then_some(idx))
        .collect();

    if progress_indices.is_empty() {
        args.insert(0, "pipe:2".to_string());
        args.insert(0, "-progress".to_string());
        return;
    }

    // Ensure structured progress is always emitted to stderr (`pipe:2`) so the
    // backend can parse it reliably. Advanced templates may specify a custom
    // `-progress` target (e.g. `pipe:1`), which would otherwise make the UI
    // progress freeze even though ffmpeg is running.
    let last_idx = *progress_indices
        .last()
        .expect("progress_indices is non-empty");
    if last_idx + 1 >= args.len() {
        args.insert(last_idx + 1, "pipe:2".to_string());
    } else {
        args[last_idx + 1] = "pipe:2".to_string();
    }

    // If multiple `-progress` flags are present, keep the last (ffmpeg uses the
    // last value) and remove earlier ones so command lines remain predictable.
    if progress_indices.len() > 1 {
        progress_indices.pop();
        for idx in progress_indices.into_iter().rev() {
            args.remove(idx);
            if idx < args.len() {
                args.remove(idx);
            }
        }
    }
}
