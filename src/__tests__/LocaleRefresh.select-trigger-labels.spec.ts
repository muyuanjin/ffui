// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import SettingsTaskbarProgressSection from "@/components/panels/SettingsTaskbarProgressSection.vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { AppSettings } from "@/types";
import type { QueueFilterKind, QueueFilterStatus } from "@/composables";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => false,
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
  };
});

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      en: en as any,
      "zh-CN": zhCN as any,
    },
  });

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  uiScalePercent: 100,
  uiFontSizePercent: 100,
  uiFontFamily: "system",
  uiFontName: undefined,
  uiFontDownloadId: undefined,
  uiFontFilePath: undefined,
  uiFontFileSourceName: undefined,
});

describe("Locale refresh for select trigger labels", () => {
  it("updates the queue view mode trigger label when locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: null,
        presets: [],
        queueViewModeModel: "detail",
        presetSortMode: "manual",
        queueOutputPolicy: undefined,
      },
      global: { plugins: [i18n] },
    });

    const trigger = wrapper.get('[data-testid="ffui-queue-view-mode-trigger"]');
    expect(trigger.text()).toContain("详情列表");

    i18n.global.locale.value = "en";
    await nextTick();
    expect(trigger.text()).toContain("Detailed list");

    wrapper.unmount();
  });

  it("updates the settings font mode trigger label when locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(SettingsAppearanceSection, {
      props: {
        appSettings: makeAppSettings(),
      },
      global: { plugins: [i18n] },
    });

    const trigger = wrapper.get('[data-testid="settings-ui-font-mode-trigger"]');
    expect(trigger.text()).toContain("系统默认");

    i18n.global.locale.value = "en";
    await nextTick();
    expect(trigger.text()).toContain("System default");

    wrapper.unmount();
  });

  it("updates the queue secondary header mode trigger label when locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(QueueFiltersBar, {
      props: {
        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        sortSecondary: "filename",
        sortSecondaryDirection: "asc",
        hasActiveFilters: false,
        hasSelection: false,
        selectedCount: 0,
        hasPrimarySortTies: false,
        queueMode: "display",
        visibleCount: 0,
        totalCount: 0,
      },
      global: { plugins: [i18n] },
    });

    const trigger = wrapper.get('[data-testid="queue-mode-trigger"]');
    expect(trigger.text()).toContain("视图排序");

    i18n.global.locale.value = "en";
    await nextTick();
    expect(trigger.text()).toContain("View-only sort");

    wrapper.unmount();
  });

  it("updates the queue secondary header sort trigger label when locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(QueueFiltersBar, {
      props: {
        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        sortSecondary: "filename",
        sortSecondaryDirection: "asc",
        hasActiveFilters: false,
        hasSelection: false,
        selectedCount: 0,
        hasPrimarySortTies: false,
        queueMode: "display",
        visibleCount: 0,
        totalCount: 0,
      },
      global: { plugins: [i18n] },
    });

    const trigger = wrapper.get('[data-testid="queue-sort-primary-trigger"]');
    expect(trigger.text()).toContain("按添加时间");

    i18n.global.locale.value = "en";
    await nextTick();
    expect(trigger.text()).toContain("Added time");

    wrapper.unmount();
  });

  it("updates the taskbar progress mode/scope trigger labels when locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(SettingsTaskbarProgressSection, {
      props: {
        appSettings: {
          ...makeAppSettings(),
          taskbarProgressMode: "byEstimatedTime",
          taskbarProgressScope: "activeAndQueued",
        },
      },
      global: { plugins: [i18n] },
    });

    const modeTrigger = wrapper.get('[data-testid="settings-taskbar-progress-mode-trigger"]');
    const scopeTrigger = wrapper.get('[data-testid="settings-taskbar-progress-scope-trigger"]');
    expect(modeTrigger.text()).toContain("按预估耗时加权");
    expect(scopeTrigger.text()).toContain("仅统计进行中/排队/等待的任务");

    i18n.global.locale.value = "en";
    await nextTick();
    expect(modeTrigger.text()).toContain("Weight by estimated processing time");
    expect(scopeTrigger.text()).toContain("Only active/queued/waiting jobs");

    wrapper.unmount();
  });
});
