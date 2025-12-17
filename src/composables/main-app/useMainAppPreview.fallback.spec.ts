// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref, nextTick } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import useMainAppDialogs from "@/composables/main-app/useMainAppDialogs";
import useMainAppPreview from "@/composables/main-app/useMainAppPreview";

vi.mock("@/lib/backend", () => ({
  hasTauri: () => false,
  buildPreviewUrl: (path: string | null) => path,
  selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
}));

const TestHarness = defineComponent({
  setup() {
    const { dialogManager } = useMainAppDialogs();
    const presets = ref<FFmpegPreset[]>([]);
    const preview = useMainAppPreview({
      presets,
      dialogManager,
    });

    return {
      dialogManager,
      ...preview,
    };
  },
  template: "<div />",
});

describe("useMainAppPreview fallback path selection", () => {
  it("handleExpandedPreviewError falls back to the next candidate path when the first one fails", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-fallback-1",
      filename: "C:/videos/fallback.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/fallback.mp4",
      outputPath: "C:/videos/fallback.compressed.mp4",
    } as any;

    // 打开预览后，completed 任务应当首先使用 outputPath。
    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewError).toBeNull();

    // 模拟 <video> 播放失败，预览逻辑应尝试下一个候选路径（inputPath）。
    vm.handleExpandedPreviewError();
    await nextTick();

    expect(vm.previewUrl).toBe(job.inputPath);
    // 仍然不应立即展示错误文案，因为还有可用的备用路径。
    expect(vm.previewError).toBeNull();

    wrapper.unmount();
  });

  it("does not silently switch across input/output when a forced source mode is selected", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-fallback-forced-1",
      filename: "C:/videos/forced.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/forced.mp4",
      outputPath: "C:/videos/forced.compressed.mp4",
    } as any;

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    // Default is auto and prefers output first for completed jobs.
    expect(vm.previewSourceMode).toBe("auto");
    expect(vm.previewUrl).toBe(job.outputPath);

    // Force output: playback error should not jump to input.
    await vm.setPreviewSourceMode("output");
    await nextTick();

    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewUrl).toBe(job.outputPath);

    vm.handleExpandedPreviewError();
    await nextTick();

    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewError).not.toBeNull();

    wrapper.unmount();
  });

  it("prefers outputPath for completed image jobs when available", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-image-1",
      filename: "C:/images/sample.avif",
      type: "image",
      source: "smart_scan",
      originalSizeMB: 2,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/images/original.png",
      outputPath: "C:/images/sample.avif",
    } as any;

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewIsImage).toBe(true);
    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewError).toBeNull();

    wrapper.unmount();
  });
});
