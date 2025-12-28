// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { provideQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { resetPreviewLoadSchedulerForTests } from "@/components/queue-item/previewLoadScheduler";
import { markPreviewDecoded, resetPreviewWarmCacheForTests } from "@/components/queue-item/previewWarmCache";

const buildJobPreviewUrlMock = vi.fn<(path: string | null | undefined, rev?: number | null) => string | null>(
  (path, rev) => {
    if (!path) return null;
    return `url:${path}?rev=${Number(rev ?? 0)}`;
  },
);

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => false,
    ensureJobPreview: vi.fn(async () => null),
    buildJobPreviewUrl: (path: string | null | undefined, rev?: number | null) => buildJobPreviewUrlMock(path, rev),
    loadPreviewDataUrl: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
  };
});

import { useQueueItemPreview } from "./useQueueItemPreview";

const makeJob = (overrides: Partial<TranscodeJob> = {}): TranscodeJob =>
  ({
    id: "job-1",
    status: "queued",
    progress: 0,
    type: "video",
    source: "manual",
    filename: "foo.mp4",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    previewPath: "C:/previews/job-1.jpg",
    previewRevision: 0,
    ...overrides,
  }) as TranscodeJob;

describe("useQueueItemPreview (scroll warm display)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildJobPreviewUrlMock.mockClear();
    resetPreviewLoadSchedulerForTests();
    resetPreviewWarmCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows already-decoded previews during scrolling without starting new loads", async () => {
    const isScrolling = ref(true);
    const isQueueRunning = ref(false);
    const job = ref(makeJob({ id: "job-warm", previewPath: "C:/previews/job-warm.jpg" }));
    const expected = "url:C:/previews/job-warm.jpg?rev=0";
    markPreviewDecoded("job-warm", expected);

    const PreviewChild = {
      name: "PreviewChild",
      setup() {
        const composable = useQueueItemPreview({
          job: computed(() => job.value),
          isTestEnv: true,
        });
        return { composable };
      },
      template: "<div />",
    };

    const wrapper = mount({
      components: { PreviewChild },
      setup() {
        provideQueuePerfHints({ isScrolling, isQueueRunning: computed(() => isQueueRunning.value) });
      },
      template: "<PreviewChild />",
    });

    const { composable } = wrapper.findComponent(PreviewChild).vm as unknown as {
      composable: ReturnType<typeof useQueueItemPreview>;
    };

    await nextTick();
    expect(composable.previewUrl.value).toBe(expected);
    expect(buildJobPreviewUrlMock).toHaveBeenCalled();
    expect(buildJobPreviewUrlMock).toHaveBeenCalledWith("C:/previews/job-warm.jpg", 0);

    await vi.runAllTimersAsync();
    await nextTick();
    expect(composable.previewUrl.value).toBe(expected);

    wrapper.unmount();
  });
});
