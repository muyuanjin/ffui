// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { computed, defineComponent, h, ref, type PropType } from "vue";
import { provideQueuePerfHints } from "@/components/panels/queue/queuePerfHints";

import QueueCarousel3DView from "./QueueCarousel3DView.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";
import { jobPreviewSourceKey } from "./previewAutoEnsure";

const requestJobPreviewAutoEnsureMock = vi.fn(
  (
    jobId: string,
    _opts: { heightPx?: number | null; cacheKey?: string | null },
  ): { promise: Promise<string | null>; cancel: () => void } => {
    return { promise: Promise.resolve(`C:/previews/thumb-cache/${jobId}-1080.jpg`), cancel: vi.fn() };
  },
);
const invalidateJobPreviewAutoEnsureMock = vi.fn();

vi.mock("@/components/queue-item/previewAutoEnsure", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("./previewAutoEnsure")>()),
    requestJobPreviewAutoEnsure: (jobId: string, opts: { heightPx?: number | null; cacheKey?: string | null }) =>
      requestJobPreviewAutoEnsureMock(jobId, opts),
    invalidateJobPreviewAutoEnsure: (jobId: string, opts: { heightPx?: number | null; cacheKey?: string | null }) =>
      invalidateJobPreviewAutoEnsureMock(jobId, opts),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null | undefined) => path ?? null,
    buildJobPreviewUrl: (path: string | null | undefined) => path ?? null,
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const makeJob = (id: string): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 1,
    presetId: "p1",
    status: "queued",
    progress: 0,
    previewPath: `C:/previews/${id}.jpg`,
    previewRevision: 1,
    logs: [],
    warnings: [],
  }) as TranscodeJob;

describe("QueueCarousel3DView (preview error recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestJobPreviewAutoEnsureMock.mockReset();
    requestJobPreviewAutoEnsureMock.mockImplementation((jobId) => ({
      promise: Promise.resolve(`C:/previews/thumb-cache/${jobId}-1080.jpg`),
      cancel: vi.fn(),
    }));
  });

  it.each([true, false])(
    "shows audio fallback when cover recovery is unavailable with auto ensure %s",
    async (allowed) => {
      requestJobPreviewAutoEnsureMock.mockImplementationOnce(() => ({
        promise: Promise.resolve(null),
        cancel: vi.fn(),
      }));
      const job = ref({ ...makeJob("audio-failed"), type: "audio" as const });
      const wrapper = mount(
        defineComponent({
          setup() {
            provideQueuePerfHints({ isScrolling: ref(!allowed), isQueueRunning: computed(() => false) });
            return () =>
              h(QueueCarousel3DView, {
                items: [{ kind: "job", job: job.value }],
                selectedJobIds: new Set<string>(),
                progressStyle: "bar",
                autoRotationSpeed: 0,
              });
          },
        }),
        { global: { plugins: [i18n] } },
      );
      const card = wrapper.findComponent({ name: "QueueCarousel3DCardContent" });
      expect(card.props("previewUrl")).toBe(job.value.previewPath);
      card.vm.$emit("previewError", job.value.id);
      await flushPromises();
      expect(card.props("previewUrl")).toBeNull();
      expect(card.find('[data-testid="queue-audio-placeholder"]').exists()).toBe(true);
      expect(requestJobPreviewAutoEnsureMock).toHaveBeenCalledTimes(allowed ? 1 : 0);
      job.value.previewRevision = 2;
      await flushPromises();
      expect(card.props("previewUrl")).toBe(job.value.previewPath);
      wrapper.unmount();
    },
  );

  it("ensures a newly visible audio cover without changing the active index", async () => {
    const initial = { ...makeJob("initial"), type: "audio" as const };
    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items: [{ kind: "job", job: initial }],
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(requestJobPreviewAutoEnsureMock).not.toHaveBeenCalled();
    const added = { ...makeJob("new-audio"), type: "audio" as const, previewPath: undefined };
    await wrapper.setProps({ items: [{ kind: "job", job: added }] });
    await flushPromises();
    expect(requestJobPreviewAutoEnsureMock).toHaveBeenCalledWith("new-audio", {
      heightPx: 180,
      cacheKey: jobPreviewSourceKey(added),
    });
    expect(wrapper.findComponent({ name: "QueueCarousel3DCardContent" }).props("previewUrl")).toBe(
      "C:/previews/thumb-cache/new-audio-1080.jpg",
    );
    wrapper.unmount();
  });

  it.each([undefined, "C:/previews/missing-cover.jpg"])(
    "loads and recovers audio covers with initial path %s",
    async (previewPath) => {
      const job = { ...makeJob("audio"), type: "audio" as const, previewPath };
      const wrapper = mount(QueueCarousel3DView, {
        props: {
          items: [{ kind: "job", job }],
          selectedJobIds: new Set<string>(),
          progressStyle: "bar",
          autoRotationSpeed: 0,
        },
        global: { plugins: [i18n] },
      });
      await flushPromises();
      if (!previewPath) {
        expect(requestJobPreviewAutoEnsureMock).toHaveBeenCalledWith("audio", {
          heightPx: 180,
          cacheKey: jobPreviewSourceKey(job),
        });
      } else {
        expect(requestJobPreviewAutoEnsureMock).not.toHaveBeenCalled();
      }
      const card = wrapper.findComponent({ name: "QueueCarousel3DCardContent" });
      card.vm.$emit("previewError", "audio");
      await flushPromises();
      const cacheKey = jobPreviewSourceKey(job);
      expect(invalidateJobPreviewAutoEnsureMock).toHaveBeenCalledWith("audio", { heightPx: 180, cacheKey });
      expect(requestJobPreviewAutoEnsureMock).toHaveBeenLastCalledWith("audio", { heightPx: 180, cacheKey });
      expect(card.props("previewUrl")).toBe("C:/previews/thumb-cache/audio-1080.jpg");
      wrapper.unmount();
    },
  );

  it("ignores an old audio cover request after its source revision changes", async () => {
    let resolveOld: (path: string | null) => void = () => {};
    const cancel = vi.fn();
    requestJobPreviewAutoEnsureMock.mockImplementationOnce(() => ({
      promise: new Promise<string | null>((resolve) => {
        resolveOld = resolve;
      }),
      cancel,
    }));
    const job = { ...makeJob("audio-revised"), type: "audio" as const, previewPath: undefined };
    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items: [{ kind: "job", job }],
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: { plugins: [i18n] },
    });
    await wrapper.setProps({ items: [{ kind: "job", job: { ...job, previewRevision: 2 } }] });
    await flushPromises();
    expect(cancel).toHaveBeenCalledOnce();
    expect(requestJobPreviewAutoEnsureMock).toHaveBeenCalledTimes(2);
    resolveOld("C:/previews/stale-cover.jpg");
    await flushPromises();
    expect(wrapper.findComponent({ name: "QueueCarousel3DCardContent" }).props("previewUrl")).toBe(
      "C:/previews/thumb-cache/audio-revised-1080.jpg",
    );
    wrapper.unmount();
  });

  it("invalidates and re-ensures 1080p preview when a card image fails", async () => {
    const items: QueueListItem[] = [{ kind: "job", job: makeJob("job-1") }];

    const CardStub = defineComponent({
      name: "QueueCarousel3DCardContent",
      props: {
        item: { type: Object as PropType<QueueListItem>, required: true },
        previewUrl: { type: String as PropType<string | null>, default: null },
        displayFilename: { type: String, default: "" },
        selected: { type: Boolean, default: false },
      },
      emits: ["previewError"],
      template: `<button data-testid="emit-error" @click="$emit('previewError', (item.kind === 'job' ? item.job.id : ''))" />`,
    });

    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items,
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueCarousel3DCardContent: CardStub,
          Badge: true,
          Button: true,
          Progress: true,
          QueueJobWarnings: true,
        },
      },
    });

    await wrapper.get("[data-testid='emit-error']").trigger("click");
    await flushPromises();

    expect(invalidateJobPreviewAutoEnsureMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ heightPx: 1080 }),
    );
    expect(requestJobPreviewAutoEnsureMock).toHaveBeenCalledWith("job-1", expect.objectContaining({ heightPx: 1080 }));

    wrapper.unmount();
  });
});
