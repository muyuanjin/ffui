// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, type Ref } from "vue";
import type { TranscodeJob, QueueStateLite } from "@/types";

const loadQueueStateMock = vi.fn<() => Promise<QueueStateLite>>();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  loadQueueStateLite: () => loadQueueStateMock(),
}));

import { applyQueueStateFromBackend, refreshQueueFromBackend, type StateSyncDeps } from "./operations-state-sync";

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
      status: "waiting",
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
      status: "waiting",
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
      status: "waiting",
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
      status: "waiting",
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
      status: "waiting",
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
      status: "waiting",
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
      status: "waiting",
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
});
