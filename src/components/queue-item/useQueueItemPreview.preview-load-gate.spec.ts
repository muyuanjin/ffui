// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { provideQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { resetPreviewLoadSchedulerForTests } from "@/components/queue-item/previewLoadScheduler";
import { resetPreviewWarmCacheForTests } from "@/components/queue-item/previewWarmCache";

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

import { useQueueItemPreview } from "./useQueueItemPreview";

describe("useQueueItemPreview (preview load gate)", () => {
  let prevRaf: any;

  beforeEach(() => {
    vi.useFakeTimers();
    buildJobPreviewUrlMock.mockClear();
    resetPreviewLoadSchedulerForTests();
    resetPreviewWarmCacheForTests();
    prevRaf = (window as any).requestAnimationFrame;
    (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (prevRaf) {
      (window as any).requestAnimationFrame = prevRaf;
      return;
    }
    try {
      delete (window as any).requestAnimationFrame;
    } catch {
      // ignore
    }
  });

  it("does not start new preview loads while scrolling and resumes once idle", async () => {
    const isScrolling = ref(true);
    const isQueueRunning = ref(true);
    const job = ref(makeJob({ id: "job-preview-gate", previewPath: "C:/previews/job-preview-gate.jpg" }));

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
    await vi.runAllTimersAsync();
    await nextTick();
    expect(composable.previewUrl.value).toBe(null);

    isScrolling.value = false;
    await nextTick();
    await vi.runAllTimersAsync();
    await nextTick();
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-preview-gate.jpg?rev=0");

    wrapper.unmount();
  });
});
