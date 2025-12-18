// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed, type Ref } from "vue";
import type { TranscodeJob, QueueStateLite } from "@/types";

const loadQueueStateMock = vi.fn<() => Promise<QueueStateLite>>();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  loadQueueStateLite: () => loadQueueStateMock(),
}));

import { applyQueueStateFromBackend, refreshQueueFromBackend, type StateSyncDeps } from "./operations-state-sync";

function makeDeps(overrides: Partial<StateSyncDeps> = {}): StateSyncDeps & { jobs: Ref<TranscodeJob[]> } {
  const jobs = overrides.jobs ?? ref<TranscodeJob[]>([]);
  const smartScanJobs = overrides.smartScanJobs ?? ref<TranscodeJob[]>([]);
  const queueError = overrides.queueError ?? ref<string | null>(null);
  const lastQueueSnapshotAtMs = overrides.lastQueueSnapshotAtMs ?? ref<number | null>(null);

  return {
    jobs,
    smartScanJobs,
    queueError,
    lastQueueSnapshotAtMs,
    t: overrides.t,
    onJobCompleted: overrides.onJobCompleted,
  };
}

describe("queue operations state sync", () => {
  beforeEach(() => {
    loadQueueStateMock.mockReset();
  });

  it("applyQueueStateFromBackend applies backend jobs snapshot and updates timestamp", () => {
    const smartScanJob: TranscodeJob = {
      id: "scan-1",
      filename: "C:/videos/scan.mp4",
      type: "video",
      source: "smart_scan",
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
      jobs: ref<TranscodeJob[]>([smartScanJob]),
      smartScanJobs: ref<TranscodeJob[]>([smartScanJob]),
    });

    const before = deps.lastQueueSnapshotAtMs.value;
    applyQueueStateFromBackend({ jobs: [backendJob] }, deps);

    // 现在后端快照是唯一事实来源，应直接覆盖本地 Smart Scan 队列，防止“后端已删但前端仍残留”。
    expect(deps.jobs.value.map((j) => j.id)).toEqual([backendJob.id]);
    expect(deps.lastQueueSnapshotAtMs.value).not.toBe(before);
  });

  it("applyQueueStateFromBackend does not duplicate smart scan jobs that already exist in backend snapshot", () => {
    const smartScanJob: TranscodeJob = {
      id: "scan-1",
      filename: "C:/videos/scan.mp4",
      type: "video",
      source: "smart_scan",
      originalSizeMB: 50,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "waiting",
      progress: 0,
      logs: [],
    };

    // 模拟 MainApp 中的实际接线：smartScanJobs 由 jobs 计算而来。
    const jobs = ref<TranscodeJob[]>([smartScanJob]);
    const smartScanJobs = computed<TranscodeJob[]>(() => jobs.value.filter((job) => job.source === "smart_scan"));

    const deps: StateSyncDeps & { jobs: Ref<TranscodeJob[]> } = {
      jobs,
      smartScanJobs,
      queueError: ref<string | null>(null),
      lastQueueSnapshotAtMs: ref<number | null>(null),
      t: undefined,
      onJobCompleted: undefined,
    };

    applyQueueStateFromBackend({ jobs: [smartScanJob] }, deps);

    // 同一个 Smart Scan 任务只应出现一次，而不是在每次快照时不断复制。
    expect(deps.jobs.value.map((j) => j.id)).toEqual([smartScanJob.id]);
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
      smartScanJobs: ref<TranscodeJob[]>([]),
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
      smartScanJobs: ref<TranscodeJob[]>([]),
      onJobCompleted,
    });

    loadQueueStateMock.mockResolvedValueOnce({ jobs: [completedJob] });

    await refreshQueueFromBackend(deps);

    expect(loadQueueStateMock).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledWith(completedJob);

    expect(deps.jobs.value).toHaveLength(1);
    expect(deps.jobs.value[0].status).toBe("completed");
    expect(deps.queueError.value).toBeNull();
  });
});
