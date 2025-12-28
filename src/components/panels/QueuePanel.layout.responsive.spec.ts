// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import { getQueueIconGridClass } from "@/composables/main-app/useMainAppQueue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import type { QueueFilterKind, QueueFilterStatus, QueueListItem } from "@/composables";

// Mock defineAsyncComponent to prevent dynamic imports from triggering
// during test teardown (avoids "Closing rpc while fetch was pending" errors).
vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue");
  return {
    ...actual,
    defineAsyncComponent: (_loader: unknown) => ({
      name: "AsyncComponentStub",
      render: () => null,
    }),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
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

const queueItemStub = {
  props: ["job"],
  template: `<div data-testid="queue-item-stub">{{ job.id }}</div>`,
};

function makeJob(): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/layout.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: "preset-1",
    status: "queued",
    progress: 0,
    logs: [],
  } as TranscodeJob;
}

const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueuePanel layout tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

describe("QueuePanel layout responsiveness", () => {
  // Flush pending async component loads to avoid "Closing rpc while fetch was pending" errors.
  afterEach(async () => {
    await flushPromises();
  });

  it("does not constrain queue width with a fixed max-w container", () => {
    const job = makeJob();
    const items: QueueListItem[] = [{ kind: "job", job }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [job],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "detail",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "display",
        isIconViewMode: false,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: getQueueIconGridClass("icon-small"),
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 500,
        hasBatchCompressBatches: false,

        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        hasSelection: false,
        hasActiveFilters: false,
        selectedJobIds: new Set<string>(),
        selectedCount: 0,

        expandedBatchIds: new Set<string>(),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: true,
          QueueBatchCompressIconBatchItem: true,
          QueueBatchCompressBatchCard: true,
        },
      },
    });

    const panel = wrapper.get("[data-testid='queue-panel']");
    expect(panel.classes()).toContain("w-full");
    expect(panel.classes()).toContain("flex");
    expect(panel.classes()).toContain("flex-col");
    expect(panel.classes()).not.toContain("max-w-4xl");
  });

  it("lets the 3D carousel mode fill the available height", () => {
    const job = makeJob();
    const items: QueueListItem[] = [{ kind: "job", job }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [job],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "carousel-3d",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "display",
        isIconViewMode: false,
        isCarousel3dViewMode: true,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: getQueueIconGridClass("icon-small"),
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 500,
        hasBatchCompressBatches: false,

        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        hasSelection: false,
        hasActiveFilters: false,
        selectedJobIds: new Set<string>(),
        selectedCount: 0,

        expandedBatchIds: new Set<string>(),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: true,
          QueueBatchCompressIconBatchItem: true,
          QueueBatchCompressBatchCard: true,
          QueueCarousel3DView: true,
        },
      },
    });

    const wrapperEl = wrapper.get("[data-testid='ffui-queue-carousel-3d-wrapper']");
    expect(wrapperEl.classes()).toContain("flex");
    expect(wrapperEl.classes()).toContain("flex-1");
    expect(wrapperEl.classes()).toContain("min-h-0");
    expect(wrapperEl.classes()).toContain("min-w-0");
    expect(wrapperEl.classes()).toContain("overflow-hidden");
    expect(wrapperEl.classes()).not.toContain("overflow-y-auto");
  });

  it("renders an auto-fit icon grid when icon mode is enabled", () => {
    const job = makeJob();
    const items: QueueListItem[] = [{ kind: "job", job }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [job],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "icon-small",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "display",
        isIconViewMode: true,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: getQueueIconGridClass("icon-small"),
        queueRowVariant: "compact",
        progressUpdateIntervalMs: 500,
        hasBatchCompressBatches: false,

        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        hasSelection: false,
        hasActiveFilters: false,
        selectedJobIds: new Set<string>(),
        selectedCount: 0,

        expandedBatchIds: new Set<string>(),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: true,
          QueueBatchCompressIconBatchItem: true,
          QueueBatchCompressBatchCard: true,
        },
      },
    });

    const grid = wrapper.get("[data-testid='queue-icon-grid']");
    expect(grid.attributes("data-queue-icon-grid-virtual")).toBe("1");
  });
});
