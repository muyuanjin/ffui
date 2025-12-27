import { describe, expect, it } from "vitest";
import { ref, type Ref } from "vue";
import type { QueueStateLiteDelta, TranscodeJob } from "@/types";
import {
  applyQueueStateFromBackend,
  applyQueueStateLiteDeltaFromBackend,
  type StateSyncDeps,
} from "@/composables/queue/operations-state-sync";

type PerfResult = {
  jobs: number;
  baselineSnapshotTicks: number;
  baselineSnapshotAvgMs: number;
  deltaTicks: number;
  deltaAvgMs: number;
  notes: string[];
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const nowMs = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const makeDeps = (jobs: Ref<TranscodeJob[]>): StateSyncDeps => {
  return {
    jobs,
    queueError: ref<string | null>(null),
    lastQueueSnapshotAtMs: ref<number | null>(null),
    lastQueueSnapshotRevision: ref<number | null>(null),
  };
};

const makeJobTemplate = (i: number, status: TranscodeJob["status"]): TranscodeJob => {
  const id = `job-${i}`;
  const filename = `C:/videos/big-queue/${String(i).padStart(6, "0")}-example-long-filename.mp4`;
  return {
    id,
    filename,
    type: "video",
    source: i % 3 === 0 ? "batch_compress" : "manual",
    originalSizeMB: 120 + (i % 900),
    originalCodec: "h264",
    presetId: "preset-1",
    status,
    progress: status === "processing" ? 0 : 0,
    outputPath: `C:/videos/out/${id}.compressed.mp4`,
    inputPath: filename,
    estimatedSeconds: 120 + (i % 600),
    mediaInfo: {
      durationSeconds: 60 + (i % 3600),
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      videoCodec: "h264",
      audioCodec: "aac",
      sizeMB: 120 + (i % 900),
    },
    previewPath: `C:/ffui/previews/${id}.jpg`,
    previewRevision: 1,
    logTail: "",
    warnings: [],
  } as TranscodeJob;
};

const shallowCloneJob = (job: TranscodeJob): TranscodeJob => ({ ...(job as any) }) as TranscodeJob;

const buildSnapshotJobs = (templates: TranscodeJob[], mutateId: string, mutateProgress: number): TranscodeJob[] => {
  const out: TranscodeJob[] = new Array(templates.length);
  for (let i = 0; i < templates.length; i += 1) {
    const next = shallowCloneJob(templates[i]);
    if (next.id === mutateId) {
      next.progress = mutateProgress;
      next.elapsedMs = Math.floor(mutateProgress * 1000);
      next.logTail = `progress=${mutateProgress.toFixed(2)}`;
    }
    out[i] = next;
  }
  return out;
};

const measure = (fn: () => void): number => {
  const started = nowMs();
  fn();
  return nowMs() - started;
};

const runScenario = (jobsCount: number): PerfResult => {
  const processingId = "job-0";
  const templates: TranscodeJob[] = [];
  for (let i = 0; i < jobsCount; i += 1) {
    templates.push(makeJobTemplate(i, i === 0 ? "processing" : "queued"));
  }

  const jobsRef = ref<TranscodeJob[]>(templates.map((j) => shallowCloneJob(j)));
  const deps = makeDeps(jobsRef);

  // Warm up: initial snapshot apply.
  applyQueueStateFromBackend(
    { snapshotRevision: 1, jobs: buildSnapshotJobs(templates, processingId, 0.01) } as any,
    deps,
  );

  // Baseline: simulate progress-only ticks delivered as full snapshots.
  const baselineTicks = 10;
  let baselineTotal = 0;
  for (let tick = 0; tick < baselineTicks; tick += 1) {
    const progress = 0.01 + tick * 0.5;
    const backendJobs = buildSnapshotJobs(templates, processingId, progress);
    baselineTotal += measure(() => {
      applyQueueStateFromBackend({ snapshotRevision: 2 + tick, jobs: backendJobs } as any, deps);
    });
  }

  // Delta: simulate high-frequency progress-only ticks delivered as patches.
  const deltaTicks = 2000;
  let deltaTotal = 0;
  const baseSnapshotRevision = 2 + baselineTicks;
  deps.lastQueueSnapshotRevision.value = baseSnapshotRevision;
  for (let tick = 0; tick < deltaTicks; tick += 1) {
    const progress = 10 + tick * 0.01;
    const delta: QueueStateLiteDelta = {
      baseSnapshotRevision,
      deltaRevision: tick + 1,
      patches: [
        {
          id: processingId,
          progress,
          elapsedMs: 123_456 + tick,
          logTail: `progress=${progress.toFixed(2)}`,
        },
      ],
    };
    deltaTotal += measure(() => {
      applyQueueStateLiteDeltaFromBackend(delta, deps);
    });
  }

  return {
    jobs: jobsCount,
    baselineSnapshotTicks: baselineTicks,
    baselineSnapshotAvgMs: round3(baselineTotal / baselineTicks),
    deltaTicks,
    deltaAvgMs: round3(deltaTotal / deltaTicks),
    notes: [
      "Baseline includes allocating N shallow job objects per tick to emulate JSON parse + snapshot delivery.",
      "Delta path reuses in-memory jobs array and patches a single job per tick.",
      "Run with: pnpm run bench:queue",
    ],
  };
};

describe("perf: queue pipeline apply costs (manual)", () => {
  it("prints baseline vs delta numbers for large queues", () => {
    const results = [1000, 10000, 50000].map(runScenario);

    for (const result of results) {
      if (result.jobs >= 10_000) {
        expect(result.deltaAvgMs).toBeGreaterThanOrEqual(0);
        expect(result.deltaAvgMs).toBeLessThanOrEqual(2);

        const ratio = result.baselineSnapshotAvgMs / Math.max(result.deltaAvgMs, 1e-9);
        expect(ratio).toBeGreaterThanOrEqual(30);
      }
    }

    // eslint-disable-next-line no-console
    console.log("[perf] queue pipeline apply benchmark:", JSON.stringify(results, null, 2));
  }, 60_000);
});
