// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { AppSettings } from "@/types";
import type { QueueFilterKind, QueueFilterStatus } from "@/composables";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

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
  smartScanDefaults: buildSmartScanDefaults(),
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

    (i18n.global.locale as any).value = "en";
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

    (i18n.global.locale as any).value = "en";
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

    (i18n.global.locale as any).value = "en";
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

    (i18n.global.locale as any).value = "en";
    await nextTick();
    expect(trigger.text()).toContain("Added time");

    wrapper.unmount();
  });
});
