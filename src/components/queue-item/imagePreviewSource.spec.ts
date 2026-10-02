// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import type { QueueListItem } from "@/composables";
import { imagePreviewSource } from "./imagePreviewSource";
import { getEffectiveBatchJobPreviewPath } from "./batchPreviewSlots";
import { useQueueItemPreview } from "./useQueueItemPreview";
import { useQueueCarouselPreviewEnsure } from "./useQueueCarouselPreviewEnsure";

vi.mock("@/lib/backend", () => ({
  hasTauri: () => false,
  buildJobPreviewUrl: (path: string | null) => path,
  buildPreviewUrl: (path: string | null) => path,
  ensureJobPreview: vi.fn(),
  loadPreviewDataUrl: vi.fn(),
}));
vi.mock("./previewLoadScheduler", () => ({
  schedulePreviewLoad: (...args: [string, () => void | Promise<void>]) => {
    void args[1]();
    return () => {};
  },
}));

const makeJob = (status: TranscodeJob["status"]): TranscodeJob => ({
  id: "image",
  filename: "C:/素材/input.jpg",
  inputPath: "C:/素材/input.jpg",
  outputPath: "D:/输出/not-created.png",
  type: "image",
  source: "manual",
  presetId: "png",
  originalSizeMB: 1,
  status,
  progress: 0,
  executionMode: "transparent",
});

describe("image queue thumbnail source", () => {
  it.each(["queued", "processing", "cancelled", "failed", "completed"] as const)(
    "keeps an available input ahead of a bound output for %s tasks",
    (status) => {
      const job = ref(makeJob(status));
      expect(imagePreviewSource(job.value)).toBe(job.value.inputPath);
      expect(getEffectiveBatchJobPreviewPath(job.value)).toBe(job.value.inputPath);
      let preview!: ReturnType<typeof useQueueItemPreview>;
      const wrapper = mount({
        setup() {
          preview = useQueueItemPreview({ job: computed(() => job.value), isTestEnv: true });
          return {};
        },
        template: "<div />",
      });
      expect(preview.previewUrl.value).toBe(job.value.inputPath);
      const item = { kind: "job", job: job.value } as QueueListItem;
      const carousel = useQueueCarouselPreviewEnsure({
        displayedItems: computed(() => [item]),
        allowAutoEnsure: computed(() => false),
        getItemJob: () => job.value,
        heightPx: 180,
      });
      expect(carousel.getPreviewUrl(item)).toBe(job.value.inputPath);
      wrapper.unmount();
    },
  );

  it("uses the backend prepared preview even when the original was replaced", () => {
    const job = { ...makeJob("completed"), previewPath: "D:/输出/published.avif" };
    expect(getEffectiveBatchJobPreviewPath(job)).toBe(job.previewPath);
  });

  it("retains completed managed and batch image output thumbnails", () => {
    const job = { ...makeJob("completed"), executionMode: "managed" as const };
    expect(imagePreviewSource(job)).toBe(job.outputPath);
    expect(imagePreviewSource({ ...job, executionMode: undefined, source: "batch_compress" } as TranscodeJob)).toBe(
      job.outputPath,
    );
  });

  it("does not treat a queued output without an input as a produced image", () => {
    const job = { ...makeJob("queued"), inputPath: undefined };
    expect(imagePreviewSource(job)).toBeNull();
    expect(getEffectiveBatchJobPreviewPath(job)).toBeNull();
    expect(imagePreviewSource({ ...job, status: "completed" })).toBe(job.outputPath);
  });
});
