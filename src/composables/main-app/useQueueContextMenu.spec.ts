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
    bulkCancel: noopAsync,
    bulkWait: noopAsync,
    bulkResume: noopAsync,
    bulkRestart: noopAsync,
    bulkMoveToTop: noopAsync,
    bulkMoveToBottom: noopAsync,
    bulkDelete: vi.fn(),
    openJobDetail: vi.fn(),
    openJobCompare: vi.fn(),
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

describe("useQueueContextMenu bulk vs single operations", () => {
  it("uses single-job cancel handler in single mode", async () => {
    const job: TranscodeJob = {
      id: "job-single",
      filename: "C:/videos/single.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "processing",
      progress: 50,
      logs: [],
    };

    const jobs = ref<TranscodeJob[]>([job]);
    const selectedJobIds = ref<Set<string>>(new Set());
    const handleCancelJob = vi.fn().mockResolvedValue(undefined);
    const bulkCancel = vi.fn().mockResolvedValue(undefined);

    const ctx = useQueueContextMenu({
      jobs,
      selectedJobIds,
      handleWaitJob: noopAsync,
      handleResumeJob: noopAsync,
      handleRestartJob: noopAsync,
      handleCancelJob,
      bulkCancel,
      bulkWait: noopAsync,
      bulkResume: noopAsync,
      bulkRestart: noopAsync,
      bulkMoveToTop: noopAsync,
      bulkMoveToBottom: noopAsync,
      bulkDelete: vi.fn(),
      openJobDetail: vi.fn(),
      openJobCompare: vi.fn(),
    });

    ctx.openQueueContextMenuForJob({ job, event: { clientX: 0, clientY: 0 } as MouseEvent });
    await ctx.handleQueueContextCancel();

    expect(handleCancelJob).toHaveBeenCalledTimes(1);
    expect(handleCancelJob).toHaveBeenCalledWith("job-single");
    expect(bulkCancel).not.toHaveBeenCalled();
  });

  it("delegates to bulk cancel handler in bulk mode", async () => {
    const job1: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/a.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "processing",
      progress: 10,
      logs: [],
    };
    const job2: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/b.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 20,
      presetId: "preset-1",
      status: "waiting",
      progress: 0,
      logs: [],
    };

    const jobs = ref<TranscodeJob[]>([job1, job2]);
    const selectedJobIds = ref<Set<string>>(new Set(["job-1", "job-2"]));
    const handleCancelJob = vi.fn().mockResolvedValue(undefined);
    const bulkCancel = vi.fn().mockResolvedValue(undefined);

    const ctx = useQueueContextMenu({
      jobs,
      selectedJobIds,
      handleWaitJob: noopAsync,
      handleResumeJob: noopAsync,
      handleRestartJob: noopAsync,
      handleCancelJob,
      bulkCancel,
      bulkWait: noopAsync,
      bulkResume: noopAsync,
      bulkRestart: noopAsync,
      bulkMoveToTop: noopAsync,
      bulkMoveToBottom: noopAsync,
      bulkDelete: vi.fn(),
      openJobDetail: vi.fn(),
      openJobCompare: vi.fn(),
    });

    ctx.openQueueContextMenuForBulk({ clientX: 10, clientY: 10 } as MouseEvent);
    await ctx.handleQueueContextCancel();

    expect(bulkCancel).toHaveBeenCalledTimes(1);
    expect(handleCancelJob).not.toHaveBeenCalled();
  });
});
