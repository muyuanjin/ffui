// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ref, defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useJobTimeDisplay } from "./useJobTimeDisplay";
import type { TranscodeJob } from "@/types";

describe("useJobTimeDisplay", () => {
  it("derives elapsed and total time from elapsedMs without inflating by media duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    const job = ref<TranscodeJob>({
      id: "job-wall-clock",
      filename: "video.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 50,
      startTime: Date.now() - 10_000,
      processingStartedMs: Date.now() - 4_000,
      elapsedMs: 4_000,
    } as any);

    const wrapper = mount(
      defineComponent({
        setup() {
          const time = useJobTimeDisplay(job);
          return { time };
        },
        template: "<div />",
      }),
    );

    const vm: any = wrapper.vm;
    expect(vm.time.shouldShowTimeInfo.value).toBe(true);
    expect(vm.time.isProcessing.value).toBe(true);
    expect(vm.time.elapsedTimeDisplay.value).toBe("0:04");
    expect(vm.time.estimatedTotalTimeDisplay.value).toBe("0:08");

    wrapper.unmount();
    vi.useRealTimers();
  });
});
