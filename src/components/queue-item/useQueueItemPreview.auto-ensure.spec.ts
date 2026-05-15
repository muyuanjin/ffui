// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useQueueItemPreview } from "./useQueueItemPreview";
import { resetPreviewAutoEnsureForTests } from "./previewAutoEnsure";
import { resetPreviewLoadSchedulerForTests } from "./previewLoadScheduler";
import { createQueuePreviewEnsurePrefetcher } from "./previewEnsurePrefetcher";
import { provideQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { resetPreviewWarmCacheForTests } from "./previewWarmCache";

const ensureJobPreviewMock = vi.fn<(jobId: string) => Promise<string | null>>(async (jobId) => {
  return `C:/previews/${jobId}.jpg`;
});
const ensureJobPreviewVariantMock = vi.fn<(jobId: string, heightPx: number) => Promise<string | null>>(
  async (jobId, heightPx) => {
    return `C:/previews/thumb-cache/${jobId}-${heightPx}.jpg`;
  },
);
const buildJobPreviewUrlMock = vi.fn<(path: string | null | undefined, rev?: number | null) => string | null>(
  (path, rev) => {
    if (!path) return null;
    return `url:${path}?rev=${Number(rev ?? 0)}`;
  },
);

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    ensureJobPreview: (jobId: string) => ensureJobPreviewMock(jobId),
    ensureJobPreviewVariant: (jobId: string, heightPx: number) => ensureJobPreviewVariantMock(jobId, heightPx),
    buildJobPreviewUrl: (path: string | null | undefined, rev?: number | null) => {
      return buildJobPreviewUrlMock(path, rev);
    },
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
    previewPath: undefined,
    previewRevision: 0,
    ...overrides,
  }) as TranscodeJob;

const mountComposable = (job: Ref<TranscodeJob>, opts?: { isScrolling?: Ref<boolean> }) => {
  const wrapper = mount({
    setup() {
      if (opts?.isScrolling) {
        provideQueuePerfHints({ isScrolling: opts.isScrolling, isQueueRunning: computed(() => false) });
      }
      const composable = useQueueItemPreview({
        job: computed(() => job.value),
        isTestEnv: true,
      });
      return { composable };
    },
    template: "<div />",
  });

  const { composable } = wrapper.vm as unknown as {
    composable: ReturnType<typeof useQueueItemPreview>;
  };

  return { wrapper, composable };
};

describe("useQueueItemPreview (auto ensure)", () => {
  const originalRequestIdleCallback = (window as any).requestIdleCallback;
  const originalCancelIdleCallback = (window as any).cancelIdleCallback;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    ensureJobPreviewMock.mockClear();
    ensureJobPreviewVariantMock.mockClear();
    buildJobPreviewUrlMock.mockClear();
    (window as any).requestIdleCallback = undefined;
    (window as any).cancelIdleCallback = undefined;
    (window as any).requestAnimationFrame = undefined;
    resetPreviewAutoEnsureForTests();
    resetPreviewLoadSchedulerForTests();
    resetPreviewWarmCacheForTests();
  });

  afterEach(() => {
    (window as any).requestIdleCallback = originalRequestIdleCallback;
    (window as any).cancelIdleCallback = originalCancelIdleCallback;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    vi.useRealTimers();
  });

  it("auto-generates preview for video jobs when previewPath is missing", async () => {
    const job = ref(makeJob({ id: "job-auto-preview" }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.previewUrl.value).toBe(null);

    await vi.runAllTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock).toHaveBeenCalledTimes(1);
    expect(ensureJobPreviewMock).toHaveBeenCalledWith("job-auto-preview");
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-auto-preview.jpg?rev=0");

    wrapper.unmount();
  });

  it("requests a larger preview variant when desiredHeightPx is provided", async () => {
    const job = ref(makeJob({ id: "job-variant", previewPath: "C:/previews/base.jpg" }));
    const wrapper = mount({
      setup() {
        provideQueuePerfHints({ isScrolling: ref(false), isQueueRunning: computed(() => false) });
        const composable = useQueueItemPreview({
          job: computed(() => job.value),
          isTestEnv: true,
          desiredHeightPx: 720,
        });
        return { composable };
      },
      template: "<div />",
    });

    const { composable } = wrapper.vm as unknown as { composable: ReturnType<typeof useQueueItemPreview> };

    await nextTick();
    await vi.runAllTimersAsync();
    await nextTick();

    expect(ensureJobPreviewVariantMock).toHaveBeenCalledWith("job-variant", 720);
    expect(composable.previewUrl.value).toBe("url:C:/previews/thumb-cache/job-variant-720.jpg?rev=0");

    wrapper.unmount();
  });

  it("reuses ensured preview across remounts to avoid re-ensuring on scroll unmounts", async () => {
    const job = ref(makeJob({ id: "job-auto-preview-cache" }));

    {
      const { composable, wrapper } = mountComposable(job);
      await nextTick();
      expect(composable.previewUrl.value).toBe(null);

      await vi.runAllTimersAsync();
      await nextTick();

      expect(ensureJobPreviewMock).toHaveBeenCalledTimes(1);
      expect(composable.previewUrl.value).toBe("url:C:/previews/job-auto-preview-cache.jpg?rev=0");
      wrapper.unmount();
    }

    {
      const { composable, wrapper } = mountComposable(job);
      await nextTick();
      expect(composable.previewUrl.value).toBe(null);

      await nextTick();
      expect(ensureJobPreviewMock).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
      await nextTick();
      expect(composable.previewUrl.value).toBe("url:C:/previews/job-auto-preview-cache.jpg?rev=0");
      wrapper.unmount();
    }
  });

  it("keeps auto-ensure active for visible blank cards even while scrolling", async () => {
    const scrolling = ref(true);
    const job = ref(makeJob({ id: "job-scroll-gate" }));
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
        provideQueuePerfHints({ isScrolling: scrolling, isQueueRunning: computed(() => false) });
      },
      template: "<PreviewChild />",
    });

    const { composable } = wrapper.findComponent(PreviewChild).vm as unknown as {
      composable: ReturnType<typeof useQueueItemPreview>;
    };

    await nextTick();
    await vi.runAllTimersAsync();
    await nextTick();
    expect(ensureJobPreviewMock).toHaveBeenCalledTimes(1);
    expect(ensureJobPreviewMock).toHaveBeenCalledWith("job-scroll-gate");
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-scroll-gate.jpg?rev=0");

    wrapper.unmount();
  });

  it("auto-generates previews even while queue is running (when not scrolling)", async () => {
    const isScrolling = ref(false);
    const isQueueRunning = ref(true);
    const job = ref(makeJob({ id: "job-auto-preview-while-running" }));

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
    expect(composable.previewUrl.value).toBe(null);

    await vi.runAllTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock).toHaveBeenCalledWith("job-auto-preview-while-running");
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-auto-preview-while-running.jpg?rev=0");

    wrapper.unmount();
  });

  it("lets visible blank-card previews outrank normal ensure prefetches", async () => {
    (window as any).requestIdleCallback = vi.fn((cb: () => void) => window.setTimeout(cb, 50));
    (window as any).cancelIdleCallback = vi.fn((handle: number) => window.clearTimeout(handle));

    const prefetcher = createQueuePreviewEnsurePrefetcher();
    prefetcher.setTargetJobs([makeJob({ id: "job-prefetch-normal" })]);

    const job = ref(makeJob({ id: "job-visible-priority" }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.previewUrl.value).toBe(null);

    await vi.runAllTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job-visible-priority",
      "job-prefetch-normal",
    ]);
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-visible-priority.jpg?rev=0");

    prefetcher.clear();
    wrapper.unmount();
  });

  it("upgrades a same-job ensure from prefetch priority to visible-card priority", async () => {
    (window as any).requestIdleCallback = vi.fn((cb: () => void) => window.setTimeout(cb, 50));
    (window as any).cancelIdleCallback = vi.fn((handle: number) => window.clearTimeout(handle));

    const prefetcher = createQueuePreviewEnsurePrefetcher();
    prefetcher.setTargetJobs([makeJob({ id: "job-prefetch-other" }), makeJob({ id: "job-visible-same" })]);

    const job = ref(makeJob({ id: "job-visible-same" }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    expect(composable.previewUrl.value).toBe(null);

    await vi.runAllTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock.mock.calls.map(([jobId]) => jobId)).toEqual(["job-visible-same", "job-prefetch-other"]);
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-visible-same.jpg?rev=0");

    prefetcher.clear();
    wrapper.unmount();
  });

  it("starts a visible blank-card ensure immediately even when a normal prefetch is already running", async () => {
    const resolvers = new Map<string, (value: string | null) => void>();
    ensureJobPreviewMock.mockImplementation((jobId) => {
      if (jobId === "job-prefetch-blocking") {
        return new Promise<string | null>((resolve) => {
          resolvers.set(jobId, resolve);
        });
      }
      return Promise.resolve(`C:/previews/${jobId}.jpg`);
    });

    const prefetcher = createQueuePreviewEnsurePrefetcher();
    prefetcher.setTargetJobs([makeJob({ id: "job-prefetch-blocking" })]);

    await vi.runOnlyPendingTimersAsync();
    expect(ensureJobPreviewMock.mock.calls.map(([jobId]) => jobId)).toEqual(["job-prefetch-blocking"]);

    const job = ref(makeJob({ id: "job-visible-during-running-prefetch" }));
    const { composable, wrapper } = mountComposable(job);

    await nextTick();
    await vi.runOnlyPendingTimersAsync();
    await nextTick();
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job-prefetch-blocking",
      "job-visible-during-running-prefetch",
    ]);
    expect(composable.previewUrl.value).toBe("url:C:/previews/job-visible-during-running-prefetch.jpg?rev=0");

    resolvers.get("job-prefetch-blocking")?.("C:/previews/job-prefetch-blocking.jpg");
    await vi.runOnlyPendingTimersAsync();

    prefetcher.clear();
    wrapper.unmount();
  });

  it("uses both ensure slots for visible blank-card previews when no prefetch is queued", async () => {
    const resolvers = new Map<string, (value: string | null) => void>();
    ensureJobPreviewMock.mockImplementation((jobId) => {
      return new Promise<string | null>((resolve) => {
        resolvers.set(jobId, resolve);
      });
    });

    const firstJob = ref(makeJob({ id: "job-visible-high-1" }));
    const secondJob = ref(makeJob({ id: "job-visible-high-2" }));

    const firstMounted = mountComposable(firstJob);
    const secondMounted = mountComposable(secondJob);

    await nextTick();
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(ensureJobPreviewMock.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job-visible-high-1",
      "job-visible-high-2",
    ]);

    resolvers.get("job-visible-high-1")?.("C:/previews/job-visible-high-1.jpg");
    resolvers.get("job-visible-high-2")?.("C:/previews/job-visible-high-2.jpg");
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(firstMounted.composable.previewUrl.value).toBe("url:C:/previews/job-visible-high-1.jpg?rev=0");
    expect(secondMounted.composable.previewUrl.value).toBe("url:C:/previews/job-visible-high-2.jpg?rev=0");

    firstMounted.wrapper.unmount();
    secondMounted.wrapper.unmount();
  });
});
