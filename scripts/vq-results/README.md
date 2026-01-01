# vq-results dataset utilities

## Build AVT-VQDB-UHD-1 curves (no videos)

This script downloads only small CSV test-result files from the public AVT-VQDB-UHD-1 repository (metadata/objective scores/MOS + codec retraining table) and produces a compact, monotonic bitrate→quality curve snapshot.

- Source repo: `https://github.com/Telecommunication-Telemedia-Assessment/AVT-VQDB-UHD-1`
- Downloads: `test_{1..4}/{metadata.csv,objective_scores.csv,mos_ci.csv}` + `codec_retraining/data.csv`
- Output: a `VqResultsSnapshot`-shaped JSON (so it can be merged with vq_results data later)

Run:

```bash
node scripts/vq-results/build-avt-vqdb-uhd-1-curves.mjs --out .cache/vq-results-datasets/avt-vqdb-uhd-1/<stamp>/avt-vqdb-uhd-1.snapshot.json
```

Notes:

- The script refuses to overwrite existing output paths.
- Curves are grouped by `(codec, width x height, frame_rate)` and aggregated by median, then forced to be monotonic nondecreasing.

## Build vq_results curves snapshot (no logs/videos)

This downloads the public `vq_results_data.js` and turns it into a `VqResultsSnapshot` JSON file.

Run:

```bash
node scripts/vq-results/build-vq-results-snapshot.mjs --out .cache/vq-results-datasets/vq_results/<stamp>/vq_results.snapshot.json
```

## Build unified snapshot (merge all supported sources)

Run:

```bash
node scripts/vq-results/build-quality-snapshot.mjs
```

## Build AVT-VQDB-UHD-1-HDR curves (no videos)

This script downloads only VMAF JSON reports from the public AVT-VQDB-UHD-1-HDR hosting and produces a compact, monotonic bitrate→quality curve snapshot.

Run:

```bash
node scripts/vq-results/build-avt-vqdb-uhd-1-hdr-curves.mjs --out .cache/vq-results-datasets/avt-vqdb-uhd-1-hdr/<stamp>/avt-vqdb-uhd-1-hdr.snapshot.json
```

### Use in app (optional)

If you place a built snapshot at `public/vq/quality_snapshot.json`, the app will prefer it over live fetching.
