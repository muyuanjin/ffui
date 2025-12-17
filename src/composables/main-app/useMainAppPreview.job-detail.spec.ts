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

describe("useMainAppPreview + useMainAppDialogs integration", () => {
  it("opening a job preview from the queue does not open the job detail dialog", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
    } as any;

    expect(vm.dialogManager.previewOpen.value).toBe(false);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(false);

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.dialogManager.previewOpen.value).toBe(true);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(false);
  });

  it("opening a job compare from the queue does not open the job detail dialog", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-compare-1",
      filename: "C:/videos/compare.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      outputPath: "C:/videos/compare.compressed.mp4",
    } as any;

    expect(vm.dialogManager.jobCompareOpen.value).toBe(false);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(false);

    vm.dialogManager.openJobCompare(job);
    await nextTick();

    expect(vm.dialogManager.jobCompareOpen.value).toBe(true);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(false);
  });

  it("keeps selectedJob and task detail when closing preview that was opened from task detail", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/detail.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
    } as any;

    // 先通过任务详情打开
    vm.dialogManager.openJobDetail(job);
    await nextTick();

    expect(vm.dialogManager.jobDetailOpen.value).toBe(true);
    expect(vm.dialogManager.selectedJob.value).toEqual(job);

    // 在任务详情中展开预览
    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.dialogManager.previewOpen.value).toBe(true);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(true);

    // 关闭预览，只应关闭预览，不应清空 selectedJob 或任务详情内容
    vm.closeExpandedPreview();
    await nextTick();

    expect(vm.dialogManager.previewOpen.value).toBe(false);
    expect(vm.dialogManager.jobDetailOpen.value).toBe(true);
    expect(vm.dialogManager.selectedJob.value).toEqual(job);
  });
});
