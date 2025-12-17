// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { JobCompareSources, TranscodeJob } from "@/types";

const extractJobCompareFrameMock = vi.fn();
const extractJobCompareConcatFrameMock = vi.fn();

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  buildPreviewUrl: (path: string) => path,
  loadPreviewDataUrl: async (path: string) => path,
  extractJobCompareFrame: (...args: any[]) => extractJobCompareFrameMock(...args),
  extractJobCompareConcatFrame: (...args: any[]) => extractJobCompareConcatFrameMock(...args),
}));

import { useJobCompareFrames } from "./useJobCompareFrames";

describe("useJobCompareFrames", () => {
  beforeEach(() => {
    extractJobCompareFrameMock.mockReset();
    extractJobCompareConcatFrameMock.mockReset();
    vi.useFakeTimers();
  });

  it("keeps the other side when one source fails", async () => {
    extractJobCompareFrameMock.mockImplementation(async ({ sourcePath }: { sourcePath: string }) => {
      if (sourcePath.includes("missing")) {
        throw new Error(
          "sourcePath is not a readable file: F:\\missing\\out.mkv: The system cannot find the file specified. (os error 2)",
        );
      }
      return "C:/previews/input.jpg";
    });

    const Harness = defineComponent({
      setup() {
        const job = ref<TranscodeJob>({
          id: "job-1",
          filename: "C:/videos/in.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 1,
          presetId: "preset-1",
          status: "processing",
          progress: 50,
          logs: [],
        });

        const sources = ref<JobCompareSources>({
          jobId: "job-1",
          inputPath: "C:/videos/in.mp4",
          output: { kind: "completed", outputPath: "F:/missing/out.mkv" },
          maxCompareSeconds: 10,
        });

        const open = ref(true);
        const totalDurationSeconds = computed(() => 10);
        const clampedTimelineSeconds = computed(() => 1);
        const usingFrameCompare = computed(() => true);

        const frames = useJobCompareFrames({
          open,
          job,
          sources,
          totalDurationSeconds,
          clampedTimelineSeconds,
          usingFrameCompare,
        });

        return { frames };
      },
      template: "<div />",
    });

    const wrapper = mount(Harness);
    const frames = (wrapper.vm as any).frames as ReturnType<typeof useJobCompareFrames>;

    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(frames.inputFrameUrl.value).toBe("C:/previews/input.jpg");
    expect(frames.inputFrameError.value).toBeNull();
    expect(frames.outputFrameUrl.value).toBeNull();
    expect(frames.outputFrameError.value).toContain("sourcePath is not a readable file");
  });
});
