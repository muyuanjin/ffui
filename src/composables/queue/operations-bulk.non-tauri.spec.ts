// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ref, computed, type Ref } from "vue";
import type { TranscodeJob } from "@/types";

const reorderQueueMock = vi.fn();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => false,
  reorderQueue: (...args: any[]) => reorderQueueMock(...args),
}));

import { reorderWaitingQueue } from "./operations-bulk";

describe("queue bulk operations (non-tauri)", () => {
  it("reorders waiting jobs locally while keeping non-waiting order stable", async () => {
    const jobs = ref<TranscodeJob[]>([
      {
        id: "completed-1",
        filename: "c.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 1,
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      } as TranscodeJob,
      {
        id: "waiting-a",
        filename: "a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 1,
        presetId: "p1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 0,
      } as TranscodeJob,
      {
        id: "processing-1",
        filename: "p.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 1,
        presetId: "p1",
        status: "processing",
        progress: 50,
        logs: [],
      } as TranscodeJob,
      {
        id: "waiting-b",
        filename: "b.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 1,
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
        queueOrder: 1,
      } as TranscodeJob,
    ]);

    const deps = {
      jobs,
      selectedJobIds: ref(new Set<string>()),
      selectedJobs: computed(() => [] as TranscodeJob[]),
      queueError: ref<string | null>(null),
      refreshQueueFromBackend: async () => {},
      handleCancelJob: async () => {},
      handleWaitJob: async () => {},
      handleResumeJob: async () => {},
      handleRestartJob: async () => {},
    } satisfies Record<string, unknown> as {
      jobs: Ref<TranscodeJob[]>;
    };

    reorderQueueMock.mockClear();
    await reorderWaitingQueue(["waiting-b", "waiting-a"], deps as any);

    expect(reorderQueueMock).not.toHaveBeenCalled();
    expect(jobs.value.map((j) => j.id)).toEqual(["waiting-b", "waiting-a", "completed-1", "processing-1"]);
  });
});
