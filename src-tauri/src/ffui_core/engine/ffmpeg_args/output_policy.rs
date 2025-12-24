use std::path::Path;

use super::normalize_container_format;
use crate::ffui_core::domain::{OutputContainerPolicy, OutputPolicy};

pub(super) fn forced_muxer_for_policy(
    policy: Option<&OutputPolicy>,
    input: &Path,
) -> Option<String> {
    let policy = policy?;
    match &policy.container {
        OutputContainerPolicy::Default => None,
        OutputContainerPolicy::KeepInput => {
            let ext = input
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|s| !s.is_empty())?;
            let muxer = normalize_container_format(&ext);
            if muxer.is_empty() { None } else { Some(muxer) }
        }
        OutputContainerPolicy::Force { format } => {
            let raw = format.trim().trim_start_matches('.');
            let muxer = normalize_container_format(raw);
            if muxer.is_empty() { None } else { Some(muxer) }
        }
    }
}

pub(super) fn enforce_output_muxer_for_template(
    args: &mut Vec<String>,
    output: &Path,
    muxer: &str,
) {
    // Best-effort enforcement for single-OUTPUT templates:
    // - remove output-scoped `-f <x>` options before the final OUTPUT token
    // - insert `-f <muxer>` immediately before the OUTPUT path
    let output_arg = output.to_string_lossy().into_owned();
    let Some(mut output_index) = args.iter().position(|a| *a == output_arg) else {
        return;
    };

    let mut last_input_index: Option<usize> = None;
    let mut i = 0usize;
    while i + 1 < output_index {
        if args[i] == "-i" {
            last_input_index = Some(i + 1);
            i += 2;
            continue;
        }
        i += 1;
    }
    let start = last_input_index.map(|idx| idx + 1).unwrap_or(0);

    let mut j = start;
    while j + 1 < output_index {
        if args[j] == "-f" {
            // Only treat as output-scoped if it appears after the last `-i`.
            args.drain(j..=j + 1);
            output_index = output_index.saturating_sub(2);
            continue;
        }
        j += 1;
    }

    args.insert(output_index, muxer.to_string());
    args.insert(output_index, "-f".to_string());
}
