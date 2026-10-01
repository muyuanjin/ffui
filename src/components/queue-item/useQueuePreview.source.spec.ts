// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useQueueItemPreview } from "./useQueueItemPreview";
import { useQueueCarouselPreviewEnsure } from "./useQueueCarouselPreviewEnsure";
import { resetPreviewAutoEnsureForTests } from "./previewAutoEnsure";

const backend = vi.hoisted(() => ({ ensure: vi.fn<() => Promise<string | null>>() }));
vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  ensureJobPreview: () => backend.ensure(),
  ensureJobPreviewVariant: vi.fn(),
  buildJobPreviewUrl: (path: string | null, revision: number) => (path ? `${path}?rev=${revision}` : null),
  buildPreviewUrl: (path: string | null) => path,
  loadPreviewDataUrl: vi.fn(),
}));

const makeJob = (): TranscodeJob => ({
  id: "audio",
  type: "audio",
  source: "manual",
  status: "queued",
  progress: 0,
  filename: "song.mp3",
  inputPath: "song.mp3",
  previewRevision: 1,
  originalSizeMB: 1,
  presetId: "audio",
});

describe("preview source identity through the shared ensure scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPreviewAutoEnsureForTests();
    backend.ensure.mockReset();
  });
  afterEach(() => {
    resetPreviewAutoEnsureForTests();
    vi.useRealTimers();
  });

  it.each(["list", "carousel"] as const)("rejects an in-flight old revision with no path in %s", async (consumer) => {
    const job = ref(makeJob());
    let resolveOld!: (path: string | null) => void;
    let resolveNew!: (path: string | null) => void;
    backend.ensure.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    backend.ensure.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
    let displayed!: () => string | null;
    const wrapper = mount(
      defineComponent({
        setup() {
          if (consumer === "list") {
            const preview = useQueueItemPreview({ job: computed(() => job.value), isTestEnv: true });
            displayed = () => preview.previewUrl.value;
          } else {
            const items = computed(() => [{ kind: "job" as const, job: job.value }]);
            const preview = useQueueCarouselPreviewEnsure({
              displayedItems: items,
              allowAutoEnsure: computed(() => true),
              getItemJob: (item) => (item.kind === "job" ? item.job : null),
              heightPx: 1080,
            });
            watch(
              () => job.value.previewRevision,
              () => {
                void preview.ensurePreviewForItem(items.value[0]);
              },
              { immediate: true },
            );
            displayed = () => preview.getPreviewUrl(items.value[0]);
          }
          return () => h("div");
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backend.ensure).toHaveBeenCalledTimes(1);
    job.value.previewRevision = 2;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    expect(backend.ensure).toHaveBeenCalledTimes(2);
    resolveOld("/old.jpg");
    await flushPromises();
    expect(displayed()).toBeNull();
    resolveNew("/current.jpg");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30);
    expect(displayed()).toBe("/current.jpg?rev=2");
    wrapper.unmount();
  });

  it("stabilizes a coverless carousel snapshot and retries a changed source", async () => {
    const job = ref(makeJob());
    const items = computed(() => [{ kind: "job" as const, job: job.value }]);
    const preview = useQueueCarouselPreviewEnsure({
      displayedItems: items,
      allowAutoEnsure: computed(() => true),
      getItemJob: (item) => (item.kind === "job" ? item.job : null),
      heightPx: 1080,
    });
    const ensure = () => preview.ensurePreviewForItem(items.value[0]);
    const publish = () => {
      job.value = { ...job.value, mediaInfo: { audioCodec: "mp3" } };
    };
    backend.ensure.mockImplementation(async () => {
      setTimeout(publish, 30);
      return null;
    });
    const stop = watch(
      () => job.value,
      () => {
        void ensure();
      },
      { immediate: true },
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(backend.ensure).toHaveBeenCalledTimes(1);
    await ensure();
    expect(backend.ensure).toHaveBeenCalledTimes(1);
    expect(preview.getPreviewUrl(items.value[0])).toBeNull();
    job.value = { ...job.value, inputPath: "changed.mp3", previewRevision: 2 };
    await vi.advanceTimersByTimeAsync(200);
    expect(backend.ensure).toHaveBeenCalledTimes(2);
    stop();
  });
});
