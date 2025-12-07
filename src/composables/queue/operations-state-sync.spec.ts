// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, type Ref } from "vue";
import type { TranscodeJob, QueueState } from "@/types";

const loadQueueStateMock = vi.fn<() => Promise<QueueState>>();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  loadQueueState: () => loadQueueStateMock(),
}));

import {
  applyQueueStateFromBackend,
  refreshQueueFromBackend,
  type StateSyncDeps,
} from "./operations-state-sync";

function makeDeps(
  overrides: Partial<StateSyncDeps> = {},
): StateSyncDeps & { jobs: Ref<TranscodeJob[]> } {
  const jobs = overrides.jobs ?? ref<TranscodeJob[]>([]);
  const smartScanJobs = overrides.smartScanJobs ?? ref<TranscodeJob[]>([]);
  const queueError = overrides.queueError ?? ref<string | null>(null);
  const lastQueueSnapshotAtMs =
    overrides.lastQueueSnapshotAtMs ?? ref<number | null>(null);

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

  it("applyQueueStateFromBackend merges smart scan jobs with backend jobs and updates timestamp", () => {
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

    expect(deps.jobs.value.map((j) => j.id)).toEqual([
      smartScanJob.id,
      backendJob.id,
    ]);
    expect(deps.lastQueueSnapshotAtMs.value).not.toBe(before);
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
