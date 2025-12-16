// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    cleanupPreviewCachesAsync: vi.fn(async () => true),
    openDevtools: vi.fn(),
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
    ensureOpenSourceFontDownloaded: vi.fn(async () => ({ id: "inter", familyName: "Inter", path: "/tmp/Inter.ttf", format: "ttf" })),
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
  smartScanDefaults: buildSmartScanDefaults(),
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

    const inputs = wrapper.findAll('input[type="number"]');
    // 1) previewCapturePercent, 2) maxParallelJobs,
    // 3) maxParallelCpuJobs, 4) maxParallelHwJobs,
    // 5) progressUpdateIntervalMs, 6) metricsIntervalMs
    expect(inputs.length).toBe(6);

    const previewInput = inputs[0].element as HTMLInputElement;
    const maxParallelInput = inputs[1].element as HTMLInputElement;
    const maxParallelCpuInput = inputs[2].element as HTMLInputElement;
    const maxParallelHwInput = inputs[3].element as HTMLInputElement;
    const progressIntervalInput = inputs[4].element as HTMLInputElement;
    const metricsIntervalInput = inputs[5].element as HTMLInputElement;

    expect(previewInput.value).toBe("25");
    // 当并行转码数未配置时，UI 应该显示默认值 2。
    expect(maxParallelInput.value).toBe("2");
    // Split-mode inputs are rendered but disabled by default; they should still
    // show engine defaults so the layout stays stable.
    expect(maxParallelCpuInput.value).toBe("2");
    expect(maxParallelHwInput.value).toBe("1");
    // 进度刷新节奏/性能监控节奏都应显示引擎默认值，而不是留空。
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

    const inputs = wrapper.findAll('input[type="number"]');
    expect(inputs.length).toBe(6);

    const maxParallelInput = inputs[1].element as HTMLInputElement;
    const maxParallelCpuInput = inputs[2].element as HTMLInputElement;
    const maxParallelHwInput = inputs[3].element as HTMLInputElement;
    const progressIntervalInput = inputs[4].element as HTMLInputElement;
    const metricsIntervalInput = inputs[5].element as HTMLInputElement;

    expect(maxParallelInput.value).toBe("4");
    expect(maxParallelCpuInput.value).toBe("2");
    expect(maxParallelHwInput.value).toBe("1");
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

    const inputs = wrapper.findAll('input[type="number"]');
    expect(inputs.length).toBe(6);

    const unified = inputs[1].element as HTMLInputElement;
    const cpu = inputs[2].element as HTMLInputElement;
    const hw = inputs[3].element as HTMLInputElement;

    expect(unified.value).toBe("2");
    expect(cpu.value).toBe("3");
    expect(hw.value).toBe("2");

    wrapper.unmount();
  });
});
