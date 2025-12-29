// @vitest-environment jsdom
import { i18n, invokeMock, setQueueJobs, useBackendMock } from "./helpers/mainAppTauriDialog";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";
import { setSelectedJobIds } from "./helpers/queueSelection";

function getJobsFromVm(vm: any): TranscodeJob[] {
  const ref = vm.jobs;
  if (Array.isArray(ref)) return ref;
  if (ref && Array.isArray(ref.value)) return ref.value;
  return [];
}

describe("MainApp queue context menu copy/reveal in Tauri mode", () => {
  it("opens input and output folders from the queue context menu", async () => {
    const jobId = "job-context-reveal";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/context-reveal.mp4",
        inputPath: "C:/videos/context-reveal.mp4",
        outputPath: "C:/videos/context-reveal-output.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "completed",
        progress: 100,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({
      reveal_path_in_folder: (payload) => {
        expect(payload?.path).toBeDefined();
        return null;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);
    await vm.refreshQueueFromBackend();
    await nextTick();

    const job = getJobsFromVm(vm)[0];
    vm.openQueueContextMenuForJob({
      job,
      event: { clientX: 0, clientY: 0 } as any,
    });

    await vm.handleQueueContextOpenInputFolder();
    await vm.handleQueueContextOpenOutputFolder();

    expect(invokeMock).toHaveBeenCalledWith("reveal_path_in_folder", {
      path: job.inputPath,
    });
    expect(invokeMock).toHaveBeenCalledWith("reveal_path_in_folder", {
      path: job.outputPath,
    });
  });

  it("copies input and output paths from the queue context menu", async () => {
    const jobId = "job-context-copy";
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/context-copy.mp4",
        inputPath: "C:/videos/context-copy.mp4",
        outputPath: "C:/videos/context-copy.compressed.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "completed",
        progress: 100,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({});

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);
    await vm.refreshQueueFromBackend();
    await nextTick();

    const job = getJobsFromVm(vm)[0];
    vm.openQueueContextMenuForJob({
      job,
      event: { clientX: 0, clientY: 0 } as any,
    });

    await vm.handleQueueContextCopyInputPath();
    await vm.handleQueueContextCopyOutputPath();

    expect(clipboardWriteText).toHaveBeenCalledWith(job.inputPath);
    expect(clipboardWriteText).toHaveBeenCalledWith(job.outputPath);
  });

  it("copies all input/output paths from the queue context menu in bulk mode", async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    const jobA = {
      id: "job-bulk-a",
      filename: "C:/videos/bulk-a.mp4",
      inputPath: "C:/videos/bulk-a.mp4",
      outputPath: "C:/videos/bulk-a.compressed.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 12,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    } as TranscodeJob;

    const jobB = {
      id: "job-bulk-b",
      filename: "C:/videos/bulk-b.mp4",
      inputPath: "C:/videos/bulk-b.mp4",
      outputPath: "C:/videos/bulk-b.compressed.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 12,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    } as TranscodeJob;

    setQueueJobs([jobA, jobB]);
    useBackendMock({});

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);
    await vm.refreshQueueFromBackend();
    await nextTick();

    // Reverse the selection order to ensure clipboard text follows queue order.
    setSelectedJobIds(vm, [jobB.id, jobA.id]);
    vm.openQueueContextMenuForBulk({ clientX: 0, clientY: 0 } as any);

    await vm.handleQueueContextCopyInputPath();
    await vm.handleQueueContextCopyOutputPath();

    expect(clipboardWriteText).toHaveBeenCalledTimes(2);
    expect(clipboardWriteText).toHaveBeenNthCalledWith(1, `${jobA.inputPath}\n${jobB.inputPath}`);
    expect(clipboardWriteText).toHaveBeenNthCalledWith(2, `${jobA.outputPath}\n${jobB.outputPath}`);
  });
});
