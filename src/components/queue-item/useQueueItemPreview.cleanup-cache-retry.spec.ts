// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useQueueItemPreview } from "./useQueueItemPreview";
import { resetPreviewAutoEnsureForTests } from "./previewAutoEnsure";
import { resetPreviewLoadSchedulerForTests } from "./previewLoadScheduler";
import { resetPreviewWarmCacheForTests } from "./previewWarmCache";

const ensureJobPreviewMock = vi.fn<(jobId: string) => Promise<string | null>>(async (jobId) => {
  return `C:/previews/${jobId}.jpg`;
});
const loadPreviewDataUrlMock = vi.fn<(path: string) => Promise<string>>(async (path) => {
  return `data:${path}`;
});
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
    ensureJobPreviewVariant: vi.fn(async () => null),
    buildJobPreviewUrl: (path: string | null | undefined, rev?: number | null) => buildJobPreviewUrlMock(path, rev),
    loadPreviewDataUrl: (path: string) => loadPreviewDataUrlMock(path),
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
    previewPath: "C:/previews/base.jpg",
    previewRevision: 0,
    ...overrides,
  }) as TranscodeJob;

describe("useQueueItemPreview (cleanup cache retry)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ensureJobPreviewMock.mockClear();
    loadPreviewDataUrlMock.mockClear();
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

  it("retries via the shared auto-ensure queue before falling back to data URL", async () => {
    const job = ref(makeJob({ id: "job-cleanup-retry" }));
    const wrapper = mount({
      setup() {
        const composable = useQueueItemPreview({ job: computed(() => job.value), isTestEnv: true });
        return { composable };
      },
      template: "<div />",
    });

    const { composable } = wrapper.vm as unknown as { composable: ReturnType<typeof useQueueItemPreview> };

    await nextTick();
    await vi.runAllTimersAsync();
    await nextTick();

    const p = composable.handlePreviewError();
    await vi.runAllTimersAsync();
    await p;
    await nextTick();

    expect(ensureJobPreviewMock).toHaveBeenCalledTimes(1);
    expect(loadPreviewDataUrlMock).toHaveBeenCalledTimes(0);
    expect(composable.previewUrl.value).toContain("url:C:/previews/job-cleanup-retry.jpg");
    expect(composable.previewUrl.value).toContain("ffuiPreviewRetry=");

    wrapper.unmount();
  });
});
