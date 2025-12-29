# Queue Performance (Production)

## Goals

- Keep scrolling, selection, and context menus responsive with large queues (100+ visible, 10k+ total jobs).
- Prevent regressions via automated performance gates that run in `check-all`.
- Avoid “hidden work” that scales with queue size on every progress tick.

## Architecture Summary

### Events

The queue UI consumes three event shapes:

- `ffui://queue-state` (legacy full snapshot, heavy; debug by default)
- `ffui://queue-state-lite` (full snapshot but trimmed fields; still heavy at high tick rates)
- `ffui://queue-state-lite-delta` (lightweight patch stream; production default for high-frequency updates)

In production builds, the backend prefers emitting `queue-state-lite-delta` at a conservative cadence and coalesces patches by `jobId` to avoid flooding the UI.

### Frontend Apply Path

The frontend applies `queue-state-lite-delta` by patching existing in-memory jobs instead of replacing the full jobs array each tick. This avoids O(N) allocations and downstream computed churn.

### Virtual List

The list view uses a virtual list (`virtua`) and must provide:

- A stable `item-size` (px) so the virtualizer can compute layouts efficiently.
- A tuned `buffer-size` to avoid over-rendering during fast scroll.

### Preview Loading

Preview thumbnails must be loaded on-demand. Any automatic “warmup/preload” that scales with the number of jobs will immediately show up as UI jank.

## Runtime Controls (Backend)

- `FFUI_QUEUE_STATE_DELTA_EMIT_MS`
  - Override delta emit interval in milliseconds.
  - Must be a positive integer; invalid values are ignored.
- `FFUI_QUEUE_STATE_FULL_EVENTS`
  - Enable/disable legacy full snapshot events.
  - Default: enabled in debug builds, disabled in release builds.

## Regression Gates

### Performance Gates

`pnpm run bench:queue` runs deterministic, CI-friendly performance tests:

- `tools/perf/queue-pipeline.perf.spec.ts`
  - Compares baseline “full snapshot apply” vs “delta apply” on large queues.
  - Enforces a minimum speedup ratio for 10k+ jobs.
- `tools/perf/queue-ui.perf.spec.ts`
  - Mounts `QueuePanel` (with a stubbed virtual list) and measures apply + `nextTick`.
  - Enforces upper bounds for delta update cost and a minimum speedup ratio.

These gates are executed by `node scripts/check-all.mjs`.

### Playwright screenshot verification

For a visual regression and smoke check with a large queue, use:

- `node tools/docs-screenshots/capture-queue-large-list-scroll-verification.mjs --jobs 2000 --processing-jobs 2`

Artifacts are written under `tools/docs-screenshots/artifacts/`.

### Duplicate Code Gates

The project enforces a strict duplication threshold:

- `pnpm run dup:frontend`
- `pnpm run dup:rust`

Any copy/paste regression that reintroduces duplicated markup or logic will fail the gate.

## Manual Verification

- Run the app with a large queue and confirm:
  - Scrolling stays smooth.
  - Selection toggles do not stall.
  - Context menus open immediately.
- If you need a local backend-side serialization comparison:
  - `cargo run --release --manifest-path tools/bench/Cargo.toml --bin bench_queue_state_lite -- --jobs 10000 --baseline-ticks 10 --delta-ticks 2000 --patches 2`
