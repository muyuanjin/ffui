// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, type Ref } from "vue";
import type { TranscodeJob, QueueStateLite } from "@/types";

const loadQueueStateMock = vi.fn<() => Promise<QueueStateLite>>();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  loadQueueStateLite: () => loadQueueStateMock(),
}));

import {
  applyQueueStateFromBackend,
  applyQueueStateLiteDeltaFromBackend,
  refreshQueueFromBackend,
  type StateSyncDeps,
} from "./operations-state-sync";
import { __test as stateSyncTest } from "./operations-state-sync";

function makeDeps(overrides: Partial<StateSyncDeps> = {}): StateSyncDeps & { jobs: Ref<TranscodeJob[]> } {
  const jobs = overrides.jobs ?? ref<TranscodeJob[]>([]);
  const queueError = overrides.queueError ?? ref<string | null>(null);
  const lastQueueSnapshotAtMs = overrides.lastQueueSnapshotAtMs ?? ref<number | null>(null);
  const lastQueueSnapshotRevision = overrides.lastQueueSnapshotRevision ?? ref<number | null>(null);

  return {
    jobs,
    queueError,
    lastQueueSnapshotAtMs,
    lastQueueSnapshotRevision,
    t: overrides.t,
    onJobCompleted: overrides.onJobCompleted,
  };
}

describe("queue operations state sync", () => {
  beforeEach(() => {
    loadQueueStateMock.mockReset();
  });

  it("applyQueueStateFromBackend applies backend jobs snapshot and updates timestamp", () => {
    const batchCompressJob: TranscodeJob = {
      id: "scan-1",
      filename: "C:/videos/scan.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 50,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const backendJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/manual.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([batchCompressJob]),
    });

    const before = deps.lastQueueSnapshotAtMs.value;
    applyQueueStateFromBackend({ jobs: [backendJob] }, deps);

    // 现在后端快照是唯一事实来源，应直接覆盖本地 Batch Compress 队列，防止“后端已删但前端仍残留”。
    expect(deps.jobs.value.map((j) => j.id)).toEqual([backendJob.id]);
    expect(deps.lastQueueSnapshotAtMs.value).not.toBe(before);
  });

  it("applyQueueStateFromBackend ignores stale snapshotRevision updates to avoid progress regressions", () => {
    const previousJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/progress.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([previousJob]),
    });

    applyQueueStateFromBackend({ snapshotRevision: 10, jobs: [{ ...previousJob, progress: 50 }] } as any, deps);
    applyQueueStateFromBackend({ snapshotRevision: 9, jobs: [{ ...previousJob, progress: 20 }] } as any, deps);

    expect(deps.lastQueueSnapshotRevision.value).toBe(10);
    expect(deps.jobs.value[0].progress).toBe(50);
  });

  it("applyQueueStateFromBackend preserves job object identity for unchanged rows to keep scrolling smooth", () => {
    const previousJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/progress.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: ["line-1"],
      outputPath: "C:/videos/out.mp4",
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([previousJob]),
    });

    const previousReactive = deps.jobs.value[0];

    const backendJob: TranscodeJob = {
      ...previousJob,
      progress: 12,
    };
    delete (backendJob as any).logs;
    delete (backendJob as any).outputPath;

    applyQueueStateFromBackend({ jobs: [backendJob] }, deps);

    expect(deps.jobs.value).toHaveLength(1);
    expect(deps.jobs.value[0]).toBe(previousReactive);
    expect(deps.jobs.value[0].progress).toBe(12);
    // Lite snapshots omit heavy log history; missing fields should clear stale values.
    expect(deps.jobs.value[0].logs).toBeUndefined();
    // Missing optional fields in the snapshot should clear stale values.
    expect(deps.jobs.value[0].outputPath).toBeUndefined();
  });

  it("applyQueueStateFromBackend keeps the jobs array reference when backend ordering is unchanged", () => {
    const jobA: TranscodeJob = {
      id: "job-a",
      filename: "C:/videos/a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const jobB: TranscodeJob = {
      id: "job-b",
      filename: "C:/videos/b.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([jobA, jobB]),
    });

    const prevArray = deps.jobs.value;
    const prevA = deps.jobs.value[0];

    applyQueueStateFromBackend(
      {
        jobs: [{ ...jobA, logLines: ["hello"] } as any, { ...jobB } as any],
      },
      deps,
    );

    expect(deps.jobs.value).toBe(prevArray);
    expect(deps.jobs.value[0]).toBe(prevA);
    expect((deps.jobs.value[0] as any).logLines).toEqual(["hello"]);
  });

  it("applyQueueStateFromBackend preserves job object identities even when backend ordering changes", () => {
    const jobA: TranscodeJob = {
      id: "job-a",
      filename: "C:/videos/a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const jobB: TranscodeJob = {
      id: "job-b",
      filename: "C:/videos/b.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([jobA, jobB]),
    });

    const refA = deps.jobs.value[0];
    const refB = deps.jobs.value[1];

    applyQueueStateFromBackend({ jobs: [jobB, jobA] }, deps);

    expect(deps.jobs.value).toHaveLength(2);
    expect(deps.jobs.value[0].id).toBe("job-b");
    expect(deps.jobs.value[1].id).toBe("job-a");
    expect(deps.jobs.value[0]).toBe(refB);
    expect(deps.jobs.value[1]).toBe(refA);
  });

  it("applyQueueStateFromBackend does not duplicate batch compress jobs that already exist in backend snapshot", () => {
    const batchCompressJob: TranscodeJob = {
      id: "scan-1",
      filename: "C:/videos/scan.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 50,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([batchCompressJob]),
    });

    applyQueueStateFromBackend({ jobs: [batchCompressJob] }, deps);

    // 同一个 Batch Compress 任务只应出现一次，而不是在每次快照时不断复制。
    expect(deps.jobs.value.map((j) => j.id)).toEqual([batchCompressJob.id]);
  });

  it("applyQueueStateFromBackend fires onJobCompleted for newly completed jobs", () => {
    const previousJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/progress.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
    };

    const completedJob: TranscodeJob = {
      ...previousJob,
      status: "completed",
      progress: 100,
    };

    const onJobCompleted = vi.fn();
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([previousJob]),
      onJobCompleted,
    });

    applyQueueStateFromBackend({ jobs: [completedJob] }, deps);

    expect(onJobCompleted).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledWith(completedJob);
    expect(deps.jobs.value).toHaveLength(1);
    expect(deps.jobs.value[0].status).toBe("completed");
  });

  it("refreshQueueFromBackend updates jobs from backend and fires onJobCompleted for new completed jobs", async () => {
    const previousJob: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/progress.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
    };

    const completedJob: TranscodeJob = {
      ...previousJob,
      status: "completed",
      progress: 100,
    };

    const onJobCompleted = vi.fn();
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([previousJob]),
      onJobCompleted,
    });

    loadQueueStateMock.mockResolvedValueOnce({ jobs: [completedJob] });

    const beforeSnapshotAt = deps.lastQueueSnapshotAtMs.value;
    await refreshQueueFromBackend(deps);

    expect(loadQueueStateMock).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledWith(completedJob);

    expect(deps.jobs.value).toHaveLength(1);
    expect(deps.jobs.value[0].status).toBe("completed");
    expect(deps.queueError.value).toBeNull();
    expect(deps.lastQueueSnapshotAtMs.value).not.toBe(beforeSnapshotAt);
  });

  it("refreshQueueFromBackend dedupes concurrent refresh calls for the same jobs ref", async () => {
    let resolvePromise!: (value: QueueStateLite) => void;
    loadQueueStateMock.mockImplementation(
      () =>
        new Promise<QueueStateLite>((r) => {
          resolvePromise = r;
        }),
    );

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([]),
    });

    const p1 = refreshQueueFromBackend(deps);
    const p2 = refreshQueueFromBackend(deps);

    expect(loadQueueStateMock).toHaveBeenCalledTimes(1);

    resolvePromise({ jobs: [] });
    await Promise.all([p1, p2]);
  });

  it("baseline: applying a progress-only full snapshot scans all jobs on the fast path", () => {
    const JOBS = 10_000;
    const jobs: TranscodeJob[] = Array.from({ length: JOBS }, (_, idx) => ({
      id: `job-${idx}`,
      filename: `C:/videos/${idx}.mp4`,
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    }));

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>(jobs),
    });

    stateSyncTest.resetPerfCounters();

    const backendJobs: TranscodeJob[] = jobs.map((j) => ({ ...j }));
    backendJobs[1234] = { ...backendJobs[1234], status: "processing", progress: 0.5 };

    applyQueueStateFromBackend({ jobs: backendJobs }, deps);

    const counters = stateSyncTest.getPerfCounters();
    expect(counters.recomputeFastPathJobsScanned).toBe(JOBS);
    expect(counters.syncJobObjectCalls).toBe(JOBS);
  });

  it("applyQueueStateLiteDeltaFromBackend updates only patched jobs and reuses the cached id index", () => {
    const JOBS = 10_000;
    const jobs: TranscodeJob[] = Array.from({ length: JOBS }, (_, idx) => ({
      id: `job-${idx}`,
      filename: `C:/videos/${idx}.mp4`,
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    }));

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>(jobs),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    stateSyncTest.resetPerfCounters();

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [{ id: "job-1234", status: "processing", progress: 0.5, elapsedMs: 1234 }],
      },
      deps,
    );

    expect(deps.jobs.value[1234].status).toBe("processing");
    expect(deps.jobs.value[1234].progress).toBe(0.5);
    expect(deps.jobs.value[1234].elapsedMs).toBe(1234);

    const afterFirst = stateSyncTest.getPerfCounters();
    expect(afterFirst.deltaIndexBuilds).toBe(1);
    expect(afterFirst.deltaIndexJobsScanned).toBe(JOBS);
    expect(afterFirst.syncJobObjectCalls).toBe(0);

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 2,
        patches: [{ id: "job-9999", status: "processing", progress: 1 }],
      },
      deps,
    );

    expect(deps.jobs.value[9999].progress).toBe(1);

    const afterSecond = stateSyncTest.getPerfCounters();
    expect(afterSecond.deltaIndexBuilds).toBe(1);
    expect(afterSecond.deltaIndexJobsScanned).toBe(JOBS);
  });

  it("applyQueueStateLiteDeltaFromBackend preserves logTail and waitMetadata when omitted from delta patches", () => {
    const waitMetadata = {
      processedWallMillis: 1234,
      tmpOutputPath: "C:/tmp/seg0.mkv",
      segments: ["C:/tmp/seg0.mkv"],
    };

    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/live-log.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "processing",
          progress: 1,
          logs: [],
          logTail: "keep-this-tail",
          waitMetadata: waitMetadata as any,
        },
      ]),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [{ id: "job-1", progress: 2 }],
      },
      deps,
    );

    expect(deps.jobs.value[0].progress).toBe(2);
    expect(deps.jobs.value[0].logTail).toBe("keep-this-tail");
    expect(deps.jobs.value[0].waitMetadata).toEqual(waitMetadata);
  });

  it("applyQueueStateLiteDeltaFromBackend keeps job and array identities to avoid full list re-renders", () => {
    const jobA: TranscodeJob = {
      id: "job-a",
      filename: "C:/videos/a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
      elapsedMs: 123,
      previewPath: "C:/previews/a.jpg",
      previewRevision: 1,
    };

    const jobB: TranscodeJob = {
      id: "job-b",
      filename: "C:/videos/b.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    };

    const queueProgressRevision = ref(0);
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([jobA, jobB]),
    });
    (deps as any).queueProgressRevision = queueProgressRevision;
    deps.lastQueueSnapshotRevision.value = 1;

    const beforeArray = deps.jobs.value;
    const beforeA = deps.jobs.value[0];
    const beforeB = deps.jobs.value[1];
    const beforeAt = deps.lastQueueSnapshotAtMs.value;

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [{ id: "job-a", progress: 12, elapsedMs: 234, previewPath: "C:/previews/a2.jpg", previewRevision: 2 }],
      },
      deps,
    );

    expect(deps.jobs.value).toBe(beforeArray);
    expect(deps.jobs.value[0]).toBe(beforeA);
    expect(deps.jobs.value[1]).toBe(beforeB);
    expect(deps.jobs.value[0].progress).toBe(12);
    expect(deps.jobs.value[0].elapsedMs).toBe(234);
    expect(deps.jobs.value[0].previewPath).toBe("C:/previews/a2.jpg");
    expect(deps.jobs.value[0].previewRevision).toBe(2);
    expect(deps.lastQueueSnapshotAtMs.value).not.toBe(beforeAt);
    expect(queueProgressRevision.value).toBe(1);
  });

  it("applyQueueStateLiteDeltaFromBackend does not track volatile dirty ids when UI sorting does not need them", () => {
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/progress.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "processing",
          progress: 10,
          logs: [],
        },
      ]),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    const queueProgressRevision = ref(0);
    const queueVolatileSortDirtyJobIds = ref<Set<string>>(new Set(["stale-id"]));
    const trackVolatileSortDirtyJobIds = ref(false);
    (deps as any).queueProgressRevision = queueProgressRevision;
    (deps as any).queueVolatileSortDirtyJobIds = queueVolatileSortDirtyJobIds;
    (deps as any).trackVolatileSortDirtyJobIds = trackVolatileSortDirtyJobIds;

    applyQueueStateLiteDeltaFromBackend(
      { baseSnapshotRevision: 1, deltaRevision: 1, patches: [{ id: "job-1", progress: 11, elapsedMs: 1000 }] },
      deps,
    );

    expect(deps.jobs.value[0].progress).toBe(11);
    expect(deps.jobs.value[0].elapsedMs).toBe(1000);
    expect(queueProgressRevision.value).toBe(0);
    expect(queueVolatileSortDirtyJobIds.value.size).toBe(0);
  });

  it("applyQueueStateLiteDeltaFromBackend applies progress decreases (restart/resume semantics)", () => {
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/restart.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "processing",
          progress: 80,
          logs: [],
        },
      ]),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 10,
        patches: [{ id: "job-1", status: "queued", progress: 0 }],
      },
      deps,
    );

    expect(deps.jobs.value[0].status).toBe("queued");
    expect(deps.jobs.value[0].progress).toBe(0);
  });

  it("applyQueueStateLiteDeltaFromBackend applies progress telemetry into waitMetadata", () => {
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/progress.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "processing",
          progress: 10,
          logs: [],
        },
      ]),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [
          {
            id: "job-1",
            progressOutTimeSeconds: 12.5,
            progressSpeed: 1.25,
            progressUpdatedAtMs: 123_456,
            progressEpoch: 2,
          },
        ],
      },
      deps,
    );

    expect(deps.jobs.value[0].waitMetadata?.lastProgressOutTimeSeconds).toBeCloseTo(12.5, 6);
    expect(deps.jobs.value[0].waitMetadata?.lastProgressSpeed).toBeCloseTo(1.25, 6);
    expect(deps.jobs.value[0].waitMetadata?.lastProgressUpdatedAtMs).toBe(123_456);
    expect(deps.jobs.value[0].waitMetadata?.progressEpoch).toBe(2);
  });

  it("applyQueueStateLiteDeltaFromBackend can override a stale paused status when progress resumes", () => {
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/resume.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "paused",
          progress: 42,
          logs: [],
        },
      ]),
    });
    deps.lastQueueSnapshotRevision.value = 1;

    applyQueueStateLiteDeltaFromBackend(
      {
        baseSnapshotRevision: 1,
        deltaRevision: 1,
        patches: [{ id: "job-1", status: "processing", progress: 43 }],
      },
      deps,
    );

    expect(deps.jobs.value[0].status).toBe("processing");
    expect(deps.jobs.value[0].progress).toBe(43);
  });

  it("applyQueueStateLiteDeltaFromBackend ignores stale or mismatched delta updates", () => {
    const deps = makeDeps({
      jobs: ref<TranscodeJob[]>([
        {
          id: "job-1",
          filename: "C:/videos/progress.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 100,
          presetId: "preset-1",
          status: "processing",
          progress: 10,
          logs: [],
        },
      ]),
    });

    deps.lastQueueSnapshotRevision.value = 1;

    applyQueueStateLiteDeltaFromBackend(
      { baseSnapshotRevision: 1, deltaRevision: 2, patches: [{ id: "job-1", progress: 50 }] },
      deps,
    );
    expect(deps.jobs.value[0].progress).toBe(50);

    // Stale deltaRevision should be ignored.
    applyQueueStateLiteDeltaFromBackend(
      { baseSnapshotRevision: 1, deltaRevision: 2, patches: [{ id: "job-1", progress: 20 }] },
      deps,
    );
    expect(deps.jobs.value[0].progress).toBe(50);

    // Mismatched baseSnapshotRevision should be ignored.
    applyQueueStateLiteDeltaFromBackend(
      { baseSnapshotRevision: 999, deltaRevision: 3, patches: [{ id: "job-1", progress: 90 }] },
      deps,
    );
    expect(deps.jobs.value[0].progress).toBe(50);

    // New snapshot revision resets delta ordering and accepts deltas for the new base.
    applyQueueStateFromBackend({ snapshotRevision: 2, jobs: deps.jobs.value.map((j) => ({ ...j })) } as any, deps);
    applyQueueStateLiteDeltaFromBackend(
      { baseSnapshotRevision: 2, deltaRevision: 1, patches: [{ id: "job-1", progress: 60 }] },
      deps,
    );
    expect(deps.jobs.value[0].progress).toBe(60);
  });
});
