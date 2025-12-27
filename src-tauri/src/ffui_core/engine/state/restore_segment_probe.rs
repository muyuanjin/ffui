use crate::ffui_core::domain::{OutputDirectoryPolicy, TranscodeJob, WaitMetadata};
use crate::ffui_core::engine::segment_discovery;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub(in crate::ffui_core::engine) struct SegmentProbe {
    pub(in crate::ffui_core::engine) id: String,
    pub(super) input_path: PathBuf,
    pub(super) output_path: Option<PathBuf>,
    pub(super) scan_output_dir: bool,
    pub(super) scan_input_dir: bool,
    pub(super) progress: f64,
    pub(super) elapsed_ms: Option<u64>,
    pub(super) existing_wait_metadata: Option<WaitMetadata>,
}

pub(in crate::ffui_core::engine) fn build_segment_probe_for_job(
    job: &TranscodeJob,
) -> SegmentProbe {
    let (scan_output_dir, scan_input_dir) = match job.output_policy.as_ref() {
        Some(policy) => match &policy.directory {
            OutputDirectoryPolicy::SameAsInput => (false, true),
            OutputDirectoryPolicy::Fixed { .. } => (true, false),
        },
        None => (true, true),
    };

    SegmentProbe {
        id: job.id.clone(),
        input_path: PathBuf::from(job.filename.trim()),
        output_path: job.output_path.as_deref().map(|s| PathBuf::from(s.trim())),
        scan_output_dir,
        scan_input_dir,
        progress: job.progress,
        elapsed_ms: job.elapsed_ms,
        existing_wait_metadata: job.wait_metadata.clone(),
    }
}

pub(in crate::ffui_core::engine) fn wait_metadata_has_no_usable_paths(meta: &WaitMetadata) -> bool {
    if let Some(segs) = meta.segments.as_ref()
        && segs.iter().any(|s| {
            let trimmed = s.trim();
            !trimmed.is_empty() && Path::new(trimmed).exists()
        })
    {
        return false;
    }
    if let Some(tmp) = meta.tmp_output_path.as_ref() {
        let trimmed = tmp.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return false;
        }
    }
    true
}

#[derive(Default)]
pub(in crate::ffui_core::engine) struct SegmentDirCache {
    by_dir: HashMap<PathBuf, HashMap<String, Vec<segment_discovery::SegmentCandidate>>>,
}

pub(in crate::ffui_core::engine) fn recover_wait_metadata_from_filesystem(
    probe: &SegmentProbe,
    cache: &mut SegmentDirCache,
) -> Option<WaitMetadata> {
    let started_or_progressed = probe.progress > 0.0 || probe.elapsed_ms.is_some_and(|ms| ms > 0);

    if !started_or_progressed {
        let legacy_tmp = segment_discovery::build_legacy_video_tmp_output_path(&probe.input_path);
        let legacy_tmp_exists = legacy_tmp.as_ref().is_some_and(|p| p.exists());
        let output_seg0_exists = probe.scan_output_dir
            && probe
                .output_path
                .as_ref()
                .and_then(|p| build_output_segment0_candidate_path(p, &probe.id))
                .is_some_and(|p| p.exists());
        let existing_paths_exist = probe.existing_wait_metadata.as_ref().is_some_and(|meta| {
            wait_metadata_existing_paths(meta)
                .iter()
                .any(|p| p.exists())
        });

        if !legacy_tmp_exists && !output_seg0_exists && !existing_paths_exist {
            return None;
        }
    }

    let mut found: BTreeMap<u64, PathBuf> = BTreeMap::new();

    // 1) Prefer output-path-derived segments (supports fixed output directories
    // and the post-refactor "{stem}.{jobId}.segN.tmp.{ext}" naming).
    if probe.scan_output_dir
        && let Some(output_path) = probe.output_path.as_ref()
    {
        discover_segments_for_output_path_cached(output_path, &probe.id, &mut found, cache);
    }

    // 2) Also scan for per-job ".compressed.{jobId}.segN.tmp.*" segments placed
    // next to the input (legacy, or same-as-input output policy).
    if probe.scan_input_dir && found.is_empty() {
        discover_segments_for_input_path_cached(&probe.input_path, &probe.id, &mut found, cache);
    }

    // 3) Fall back to a single legacy temp output file when segment naming is unknown.
    if found.is_empty()
        && let Some(legacy_tmp) =
            segment_discovery::build_legacy_video_tmp_output_path(&probe.input_path)
        && legacy_tmp.exists()
    {
        found.insert(0, legacy_tmp);
    }

    // 4) Merge in any existing wait metadata paths that still exist on disk.
    if let Some(existing) = probe.existing_wait_metadata.as_ref() {
        for (idx, path) in wait_metadata_existing_paths(existing)
            .into_iter()
            .enumerate()
        {
            if path.exists() {
                // Use a stable, monotonic key when we cannot parse the true segment index.
                let key = u64::try_from(10_000_000usize.saturating_add(idx)).unwrap_or(u64::MAX);
                found.entry(key).or_insert(path);
            }
        }
    }

    let mut segments: Vec<String> = Vec::new();
    for (_idx, path) in found {
        segments.push(path.to_string_lossy().into_owned());
    }
    if segments.is_empty() {
        return None;
    }

    let last = segments.last().cloned();
    let mut meta = probe
        .existing_wait_metadata
        .clone()
        .unwrap_or(WaitMetadata {
            last_progress_percent: Some(probe.progress),
            processed_wall_millis: probe.elapsed_ms,
            processed_seconds: None,
            target_seconds: None,
            last_progress_out_time_seconds: None,
            last_progress_frame: None,
            tmp_output_path: None,
            segments: None,
            segment_end_targets: None,
        });
    meta.last_progress_percent = meta.last_progress_percent.or(Some(probe.progress));
    meta.processed_wall_millis = meta.processed_wall_millis.or(probe.elapsed_ms);
    meta.segments = Some(segments);
    meta.tmp_output_path = last;

    // If we reconstructed/merged segment paths, any per-segment join targets
    // are no longer guaranteed to align. Let the resume pipeline probe or
    // rebuild targets conservatively.
    meta.segment_end_targets = None;

    Some(meta)
}

fn build_output_segment0_candidate_path(output_path: &Path, job_id: &str) -> Option<PathBuf> {
    let parent = output_path.parent()?;
    let stem = output_path.file_stem().and_then(|s| s.to_str())?;
    let ext = output_path.extension().and_then(|s| s.to_str())?;
    Some(parent.join(format!("{stem}.{job_id}.seg0.tmp.{ext}")))
}

fn discover_segments_for_output_path_cached(
    output_path: &Path,
    job_id: &str,
    out: &mut BTreeMap<u64, PathBuf>,
    cache: &mut SegmentDirCache,
) {
    let Some(parent) = output_path.parent() else {
        return;
    };
    let Some(stem) = output_path.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let expected_ext = output_path.extension().and_then(|s| s.to_str());
    let prefix = format!("{stem}.{job_id}.seg");
    discover_segments_in_dir_cached(parent, &prefix, expected_ext, out, cache);
}

fn discover_segments_for_input_path_cached(
    input_path: &Path,
    job_id: &str,
    out: &mut BTreeMap<u64, PathBuf>,
    cache: &mut SegmentDirCache,
) {
    let Some(parent) = input_path.parent() else {
        return;
    };
    let Some(stem) = input_path.file_stem().and_then(|s| s.to_str()) else {
        return;
    };
    let prefix = format!("{stem}.compressed.{job_id}.seg");
    discover_segments_in_dir_cached(parent, &prefix, None, out, cache);
}

fn discover_segments_in_dir_cached(
    dir: &Path,
    prefix: &str,
    expected_ext: Option<&str>,
    out: &mut BTreeMap<u64, PathBuf>,
    cache: &mut SegmentDirCache,
) {
    let by_prefix = cache.by_dir.entry(dir.to_path_buf()).or_insert_with(|| {
        let mut map: HashMap<String, Vec<segment_discovery::SegmentCandidate>> = HashMap::new();
        for cand in segment_discovery::list_segment_candidates_in_dir(dir) {
            map.entry(cand.prefix.clone()).or_default().push(cand);
        }
        map
    });

    let Some(cands) = by_prefix.get(prefix) else {
        return;
    };
    for cand in cands {
        if let Some(expected) = expected_ext
            && !cand.ext.eq_ignore_ascii_case(expected)
        {
            continue;
        }
        out.entry(cand.idx).or_insert_with(|| cand.path.clone());
    }
}

fn wait_metadata_existing_paths(meta: &WaitMetadata) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(segs) = meta.segments.as_ref() {
        for s in segs {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                continue;
            }
            out.push(PathBuf::from(trimmed));
        }
    }
    if out.is_empty()
        && let Some(tmp) = meta.tmp_output_path.as_ref()
    {
        let trimmed = tmp.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
        }
    }
    out
}
