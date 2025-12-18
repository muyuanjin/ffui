// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "@/components/panels/QueuePanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueFilterKind, QueueFilterStatus } from "@/composables";
import { basePreset } from "./queueItemDisplayTestUtils";

const createI18nInstance = (locale: "en" | "zh-CN") =>
  createI18n({
    legacy: false,
    locale,
    messages: {
      en: en as any,
      "zh-CN": zhCN as any,
    },
  });

describe("QueuePanel empty state badge", () => {
  it("keeps the English queue label inside the 48px badge", () => {
    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [],
        visibleQueueItems: [],
        iconViewItems: [],
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
        carouselAutoRotationSpeed: 1,
        iconViewSize: "medium",
        iconGridClass: "",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 250,
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
      },
      global: {
        plugins: [createI18nInstance("en")],
      },
    });

    const badge = wrapper.get("[data-testid='ffui-empty-queue-badge']");
    expect(badge.classes()).toContain("overflow-hidden");

    const label = wrapper.get("[data-testid='ffui-empty-queue-badge-label']");
    expect(label.classes()).toContain("flex");
    expect(label.classes()).toContain("flex-col");

    expect(wrapper.get("[data-testid='ffui-empty-queue-badge-line-0']").text()).toBe("Transcode");
    expect(wrapper.get("[data-testid='ffui-empty-queue-badge-line-1']").text()).toBe("Queue");
  });

  it("splits the Chinese queue label into 2+2 lines", () => {
    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [],
        visibleQueueItems: [],
        iconViewItems: [],
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
        carouselAutoRotationSpeed: 1,
        iconViewSize: "medium",
        iconGridClass: "",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 250,
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
      },
      global: {
        plugins: [createI18nInstance("zh-CN")],
      },
    });

    expect(wrapper.get("[data-testid='ffui-empty-queue-badge-line-0']").text()).toBe("任务");
    expect(wrapper.get("[data-testid='ffui-empty-queue-badge-line-1']").text()).toBe("队列");
  });
});
