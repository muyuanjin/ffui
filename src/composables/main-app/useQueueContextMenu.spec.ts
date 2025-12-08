// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import type { TranscodeJob } from "@/types";

const revealPathInFolderMock = vi.fn();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  revealPathInFolder: (...args: any[]) => revealPathInFolderMock(...args),
}));

const noopAsync = vi.fn().mockResolvedValue(undefined);

function createContext(job: TranscodeJob) {
  const jobs = ref<TranscodeJob[]>([job]);
  const selectedJobIds = ref<Set<string>>(new Set());

  return useQueueContextMenu({
    jobs,
    selectedJobIds,
    handleWaitJob: noopAsync,
    handleResumeJob: noopAsync,
    handleRestartJob: noopAsync,
    handleCancelJob: noopAsync,
    bulkMoveToTop: noopAsync,
    bulkMoveToBottom: noopAsync,
    bulkDelete: vi.fn(),
    openJobDetail: vi.fn(),
  });
}

describe("useQueueContextMenu file reveal", () => {
  beforeEach(() => {
    revealPathInFolderMock.mockReset();
  });

  it("reveals input and output paths for the selected job", async () => {
    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/input.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/input.mp4",
      outputPath: "C:/videos/output.mp4",
    };

    const ctx = createContext(job);
    ctx.openQueueContextMenuForJob({ job, event: { clientX: 0, clientY: 0 } as MouseEvent });

    await ctx.handleQueueContextOpenInputFolder();
    await ctx.handleQueueContextOpenOutputFolder();

    expect(revealPathInFolderMock).toHaveBeenCalledWith("C:/videos/input.mp4");
    expect(revealPathInFolderMock).toHaveBeenCalledWith("C:/videos/output.mp4");
  });

  it("falls back to temporary output when the final output path is absent", async () => {
    const job: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/input2.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "processing",
      progress: 50,
      logs: [],
      inputPath: "C:/videos/input2.mp4",
      waitMetadata: { tmpOutputPath: "C:/videos/tmp-output.mp4" },
    };

    const ctx = createContext(job);
    ctx.openQueueContextMenuForJob({ job, event: { clientX: 5, clientY: 5 } as MouseEvent });

    await ctx.handleQueueContextOpenOutputFolder();

    expect(revealPathInFolderMock).toHaveBeenCalledWith("C:/videos/tmp-output.mp4");
  });
});
