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
    if args.iter().any(|arg| arg == "-progress") {
        return;
    }

    args.insert(0, "pipe:2".to_string());
    args.insert(0, "-progress".to_string());
}
