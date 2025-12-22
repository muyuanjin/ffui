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
  it("handleExpandedPreviewError retries input playback when output fails in auto mode", async () => {
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

    // 模拟 <video> 播放失败：自动切换到输入重试原生播放。
    await vm.handleExpandedPreviewError();
    await nextTick();

    expect(vm.previewUrl).toBe(job.inputPath);
    expect(vm.previewError).toBeNull();

    wrapper.unmount();
  });

  it("switches to input when the user selects input mode", async () => {
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

    // 默认优先输出（completed 任务应先尝试 outputPath）。
    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewUrl).toBe(job.outputPath);

    // 手动切到输入：应先尝试 inputPath。
    await vm.setPreviewSourceMode("input");
    await nextTick();

    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewUrl).toBe(job.inputPath);

    wrapper.unmount();
  });

  it("falls back to output frames when both output and input fail natively in auto mode", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-fallback-both-1",
      filename: "C:/videos/both.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/both.mp4",
      outputPath: "C:/videos/both.compressed.mp4",
    } as any;

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewSourceMode).toBe("output");

    // First failure: try input
    await vm.handleExpandedPreviewError();
    await nextTick();
    expect(vm.previewUrl).toBe(job.inputPath);
    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewError).toBeNull();

    // Second failure: fall back to output frames
    await vm.handleExpandedPreviewError();
    await nextTick();
    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewError).toBeTruthy();

    wrapper.unmount();
  });

  it("prefers outputPath for completed image jobs when available", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-image-1",
      filename: "C:/images/sample.avif",
      type: "image",
      source: "batch_compress",
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
