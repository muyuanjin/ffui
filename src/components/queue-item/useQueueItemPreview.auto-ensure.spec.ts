// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useQueueItemPreview } from "./useQueueItemPreview";
import { resetPreviewAutoEnsureForTests } from "./previewAutoEnsure";
import { resetPreviewLoadSchedulerForTests } from "./previewLoadScheduler";
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
  beforeEach(() => {
    vi.useFakeTimers();
    ensureJobPreviewMock.mockClear();
    ensureJobPreviewVariantMock.mockClear();
    buildJobPreviewUrlMock.mockClear();
    (window as any).requestIdleCallback = undefined;
    (window as any).requestAnimationFrame = undefined;
    resetPreviewAutoEnsureForTests();
    resetPreviewLoadSchedulerForTests();
    resetPreviewWarmCacheForTests();
  });

  afterEach(() => {
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

  it("defers auto-ensure while scrolling and resumes once idle", async () => {
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
    expect(ensureJobPreviewMock).toHaveBeenCalledTimes(0);
    expect(composable.previewUrl.value).toBe(null);

    scrolling.value = false;
    await nextTick();
    await vi.runAllTimersAsync();
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
});
