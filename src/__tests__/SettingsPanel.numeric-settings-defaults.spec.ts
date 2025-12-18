// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    cleanupPreviewCachesAsync: vi.fn(async () => true),
    openDevtools: vi.fn(),
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
    ensureOpenSourceFontDownloaded: vi.fn(async () => ({
      id: "inter",
      familyName: "Inter",
      path: "/tmp/Inter.ttf",
      format: "ttf",
    })),
    fetchExternalToolStatuses: vi.fn(async () => [] as ExternalToolStatus[]),
    fetchExternalToolStatusesCached: vi.fn(async () => [] as ExternalToolStatus[]),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => {
      // Return unlisten noop for tests.
      return () => {};
    }),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
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
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

describe("SettingsPanel numeric settings defaults", () => {
  it("shows engine defaults when numeric settings are unset", () => {
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const previewInput = wrapper.get('input[data-testid="settings-preview-capture-percent"]')
      .element as HTMLInputElement;
    expect(previewInput.value).toBe("25");

    // Default mode is unified; only the unified cap input should be shown.
    const maxParallelInput = wrapper.get('input[data-testid="settings-max-parallel-jobs"]').element as HTMLInputElement;
    expect(maxParallelInput.value).toBe("2");
    expect(wrapper.find('input[data-testid="settings-max-parallel-cpu-jobs"]').exists()).toBe(false);
    expect(wrapper.find('input[data-testid="settings-max-parallel-hw-jobs"]').exists()).toBe(false);

    const progressIntervalInput = wrapper.get('input[data-testid="settings-progress-update-interval-ms"]')
      .element as HTMLInputElement;
    const metricsIntervalInput = wrapper.get('input[data-testid="settings-metrics-interval-ms"]')
      .element as HTMLInputElement;
    expect(progressIntervalInput.value).toBe("250");
    expect(metricsIntervalInput.value).toBe("1000");

    wrapper.unmount();
  });

  it("respects explicitly configured numeric values", () => {
    const appSettings: AppSettings = {
      ...makeAppSettings(),
      maxParallelJobs: 4,
      progressUpdateIntervalMs: 500,
      metricsIntervalMs: 2000,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings,
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const maxParallelInput = wrapper.get('input[data-testid="settings-max-parallel-jobs"]').element as HTMLInputElement;
    expect(maxParallelInput.value).toBe("4");
    expect(wrapper.find('input[data-testid="settings-max-parallel-cpu-jobs"]').exists()).toBe(false);
    expect(wrapper.find('input[data-testid="settings-max-parallel-hw-jobs"]').exists()).toBe(false);

    const progressIntervalInput = wrapper.get('input[data-testid="settings-progress-update-interval-ms"]')
      .element as HTMLInputElement;
    const metricsIntervalInput = wrapper.get('input[data-testid="settings-metrics-interval-ms"]')
      .element as HTMLInputElement;
    expect(progressIntervalInput.value).toBe("500");
    expect(metricsIntervalInput.value).toBe("2000");

    wrapper.unmount();
  });

  it("shows and respects split CPU/HW concurrency values", () => {
    const appSettings: AppSettings = {
      ...makeAppSettings(),
      parallelismMode: "split",
      maxParallelCpuJobs: 3,
      maxParallelHwJobs: 2,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings,
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    expect(wrapper.find('input[data-testid="settings-max-parallel-jobs"]').exists()).toBe(false);

    const cpu = wrapper.get('input[data-testid="settings-max-parallel-cpu-jobs"]').element as HTMLInputElement;
    const hw = wrapper.get('input[data-testid="settings-max-parallel-hw-jobs"]').element as HTMLInputElement;

    expect(cpu.value).toBe("3");
    expect(hw.value).toBe("2");
    expect(wrapper.get('[data-testid="settings-parallelism-summary"]').text()).toContain("5");

    wrapper.unmount();
  });
});
