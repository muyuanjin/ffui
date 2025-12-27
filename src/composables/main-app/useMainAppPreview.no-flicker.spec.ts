// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref, nextTick } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import useMainAppDialogs from "@/composables/main-app/useMainAppDialogs";
import useMainAppPreview from "@/composables/main-app/useMainAppPreview";

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
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

describe("useMainAppPreview source switching does not flicker", () => {
  it("keeps previewUrl stable while awaiting backend path selection", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-no-flicker-1",
      filename: "C:/videos/noflicker.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/noflicker.mp4",
      outputPath: "C:/videos/noflicker.out.mp4",
    } as any;

    const { selectPlayableMediaPath } = await import("@/lib/backend");
    const selectMock = selectPlayableMediaPath as unknown as ReturnType<typeof vi.fn>;

    // openJobPreviewFromQueue selects initial path once.
    selectMock.mockResolvedValueOnce(job.outputPath);

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewUrl).toBe(job.outputPath);

    let resolveNext: (value: string | null) => void = () => {
      throw new Error("resolveNext was not initialized");
    };
    const nextPick = new Promise<string | null>((resolve) => {
      resolveNext = resolve;
    });

    selectMock.mockImplementationOnce(() => nextPick);

    const switching = vm.setPreviewSourceMode("input");
    await nextTick();

    // Switching sources should not clear the dialog media while waiting for the backend.
    expect(vm.previewUrl).toBe(job.outputPath);
    expect(vm.previewPath).toBe(job.outputPath);

    resolveNext(job.inputPath ?? null);
    await switching;
    await nextTick();

    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewUrl).toBe(job.inputPath);
    expect(vm.previewPath).toBe(job.inputPath);

    wrapper.unmount();
  });

  it("does not oscillate source mode when native errors fire repeatedly during an async switch", async () => {
    const wrapper = mount(TestHarness);
    const vm: any = wrapper.vm;

    const job: TranscodeJob = {
      id: "job-no-flicker-2",
      filename: "C:/videos/noflicker2.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/videos/noflicker2.mp4",
      outputPath: "C:/videos/noflicker2.out.mp4",
    } as any;

    const { selectPlayableMediaPath } = await import("@/lib/backend");
    const selectMock = selectPlayableMediaPath as unknown as ReturnType<typeof vi.fn>;

    selectMock.mockResolvedValueOnce(job.outputPath);
    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewUrl).toBe(job.outputPath);

    let resolveSwitch: (value: string | null) => void = () => {
      throw new Error("resolveSwitch was not initialized");
    };
    const switchPick = new Promise<string | null>((resolve) => {
      resolveSwitch = resolve;
    });
    selectMock.mockImplementationOnce(() => switchPick);

    const first = vm.handleExpandedPreviewError();
    await nextTick();

    // Re-entrant native errors should be ignored while the preview selection is in-flight.
    const second = vm.handleExpandedPreviewError();
    await nextTick();

    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewError).toBeNull();

    resolveSwitch(job.inputPath ?? null);
    await first;
    await second;
    await nextTick();

    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewUrl).toBe(job.inputPath);
    expect(vm.previewError).toBeNull();

    wrapper.unmount();
  });
});
