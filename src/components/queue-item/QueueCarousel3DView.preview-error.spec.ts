// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, type PropType } from "vue";

import QueueCarousel3DView from "./QueueCarousel3DView.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";

const requestJobPreviewAutoEnsureMock = vi.fn(
  (jobId: string, _opts: { heightPx?: number | null; cacheKey?: string | null }) => {
    return { promise: Promise.resolve(`C:/previews/thumb-cache/${jobId}-1080.jpg`), cancel: vi.fn() };
  },
);
const invalidateJobPreviewAutoEnsureMock = vi.fn();

vi.mock("@/components/queue-item/previewAutoEnsure", () => {
  return {
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
