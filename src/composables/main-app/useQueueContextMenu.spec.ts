// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";

import { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import type { TranscodeJob } from "@/types";

const revealPathInFolderMock = vi.fn();
const copyToClipboardMock = vi.fn();
let tauriAvailable = true;

vi.mock("@/lib/copyToClipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => tauriAvailable,
  revealPathInFolder: (...args: any[]) => revealPathInFolderMock(...args),
}));

const noopAsync = vi.fn().mockResolvedValue(undefined);

function createContext(job: TranscodeJob, additionalJobs: TranscodeJob[] = []) {
  const jobs = ref<TranscodeJob[]>([job, ...additionalJobs]);
  const selectedJobIds = ref<Set<string>>(new Set());

  const context = useQueueContextMenu({
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
  return { ...context, selectedJobIds };
}

describe("useQueueContextMenu file reveal", () => {
  beforeEach(() => {
    revealPathInFolderMock.mockReset();
    copyToClipboardMock.mockReset();
    tauriAvailable = true;
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

  it("copies the known audio output without using its input or requiring desktop reveal", async () => {
    tauriAvailable = false;
    const job: TranscodeJob = {
      id: "audio",
      filename: "C:/音乐/input.flac",
      inputPath: "C:/音乐/input.flac",
      outputPath: "D:/输出/output.mp3",
      type: "audio",
      source: "manual",
      presetId: "mp3",
      status: "completed",
      progress: 100,
      originalSizeMB: 1,
      executionMode: "transparent",
      logs: [],
    };
    const context = createContext(job);
    context.openQueueContextMenuForJob({ job, event: { clientX: 0, clientY: 0 } as MouseEvent });
    expect(context.queueContextMenuCanCopyOutputPath.value).toBe(true);
    expect(context.queueContextMenuCanRevealOutputPath.value).toBe(false);
    await context.handleQueueContextCopyOutputPath();
    expect(copyToClipboardMock).toHaveBeenCalledExactlyOnceWith(job.outputPath);
  });

  it("does not offer or execute output copying when an advanced command has no known output", async () => {
    const job: TranscodeJob = {
      id: "analysis",
      filename: "Analysis",
      inputPath: "C:/input.wav",
      type: "audio",
      source: "manual",
      presetId: "",
      status: "completed",
      progress: 100,
      originalSizeMB: 1,
      executionMode: "transparent",
      logs: [],
    };
    const context = createContext(job);
    context.openQueueContextMenuForJob({ job, event: { clientX: 0, clientY: 0 } as MouseEvent });
    expect(context.queueContextMenuCanCopyOutputPath.value).toBe(false);
    expect(context.queueContextMenuCanRevealOutputPath.value).toBe(false);
    await context.handleQueueContextCopyOutputPath();
    await context.handleQueueContextOpenOutputFolder();
    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(revealPathInFolderMock).not.toHaveBeenCalled();
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

  it("bulk copies only known output addresses and disables copying an unknown-only selection", async () => {
    const unknown: TranscodeJob = {
      id: "unknown",
      filename: "C:/input.wav",
      inputPath: "C:/input.wav",
      type: "audio",
      source: "manual",
      presetId: "",
      status: "completed",
      progress: 100,
      originalSizeMB: 1,
      logs: [],
      executionMode: "transparent",
    };
    const known = { ...unknown, id: "known", outputPath: "D:/输出/result.mp3" };
    const second = { ...known, id: "second", outputPath: "D:/输出/second.mp3" };
    const context = createContext(unknown, [known, second]);
    context.openQueueContextMenuForJob({ job: unknown, event: { clientX: 0, clientY: 0 } as MouseEvent });
    context.openQueueContextMenuForBulk({ clientX: 0, clientY: 0 } as MouseEvent);
    expect(context.queueContextMenuCanCopyOutputPath.value).toBe(false);
    await context.handleQueueContextCopyOutputPath();
    expect(copyToClipboardMock).not.toHaveBeenCalled();
    context.selectedJobIds.value = new Set([unknown.id, known.id, second.id]);
    expect(context.queueContextMenuCanCopyOutputPath.value).toBe(true);
    await context.handleQueueContextCopyOutputPath();
    expect(copyToClipboardMock).toHaveBeenCalledExactlyOnceWith(`${known.outputPath}\n${second.outputPath}`);
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
      status: "queued",
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

describe("useQueueContextMenu dialog actions", () => {
  it("closes the menu before opening compare", async () => {
    const job: TranscodeJob = {
      id: "job-compare",
      filename: "C:/videos/input.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "paused",
      progress: 0,
      logs: [],
    };

    const jobs = ref<TranscodeJob[]>([job]);
    const selectedJobIds = ref<Set<string>>(new Set());
    const openJobCompare = vi.fn();

    const ctx = useQueueContextMenu({
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
      openJobCompare,
    });

    ctx.openQueueContextMenuForJob({ job, event: { clientX: 0, clientY: 0 } as MouseEvent });
    expect(ctx.queueContextMenuVisible.value).toBe(true);

    ctx.handleQueueContextCompare();

    // Close is immediate; opening the dialog is deferred until after the next tick.
    expect(ctx.queueContextMenuVisible.value).toBe(false);
    expect(openJobCompare).not.toHaveBeenCalled();

    await nextTick();
    expect(openJobCompare).toHaveBeenCalledTimes(1);
    expect(openJobCompare).toHaveBeenCalledWith(job);
  });
});
