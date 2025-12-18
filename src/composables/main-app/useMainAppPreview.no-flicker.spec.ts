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

    // openJobPreviewFromQueue:
    // - resolveInitialPreviewSourceMode() uses selectPlayableMediaPath once
    // - applyPreviewSelection() uses it once again
    selectMock.mockResolvedValueOnce(job.outputPath);
    selectMock.mockResolvedValueOnce(job.outputPath);

    await vm.openJobPreviewFromQueue(job);
    await nextTick();

    expect(vm.previewSourceMode).toBe("output");
    expect(vm.previewUrl).toBe(job.outputPath);

    let resolveNext: ((value: string | null) => void) | null = null;
    const nextPick = new Promise<string | null>((resolve) => {
      resolveNext = resolve;
    });

    selectMock.mockImplementationOnce(() => nextPick);

    const switching = vm.setPreviewSourceMode("input");
    await nextTick();

    // Switching sources should not clear the dialog media while waiting for the backend.
    expect(vm.previewUrl).toBe(job.outputPath);

    resolveNext?.(job.inputPath);
    await switching;
    await nextTick();

    expect(vm.previewSourceMode).toBe("input");
    expect(vm.previewUrl).toBe(job.inputPath);

    wrapper.unmount();
  });
});

