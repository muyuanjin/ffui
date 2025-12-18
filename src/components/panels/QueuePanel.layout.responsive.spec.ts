// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import { getQueueIconGridClass } from "@/composables/main-app/useMainAppQueue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import type { QueueFilterKind, QueueFilterStatus, QueueListItem } from "@/composables";

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
    status: "waiting",
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
    expect(grid.attributes("class")).toContain("grid-cols-[repeat(auto-fill,minmax(200px,1fr))]");
  });
});
