// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import type { AppSettings, ExternalToolStatus } from "@/types";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    openDevtools: vi.fn(),
    fetchExternalToolStatuses: vi.fn(async () => [] as ExternalToolStatus[]),
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
  smartScanDefaults: {
    minImageSizeKB: 50,
    minVideoSizeMB: 50,
    minSavingRatio: 0.95,
    imageTargetFormat: "avif",
    videoPresetId: "",
  },
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
    // 3) progressUpdateIntervalMs, 4) metricsIntervalMs
    expect(inputs.length).toBe(4);

    const previewInput = inputs[0].element as HTMLInputElement;
    const maxParallelInput = inputs[1].element as HTMLInputElement;
    const progressIntervalInput = inputs[2].element as HTMLInputElement;
    const metricsIntervalInput = inputs[3].element as HTMLInputElement;

    expect(previewInput.value).toBe("25");
    // 当并行转码数未配置时，UI 应该显示“自动 = 0”而不是空白。
    expect(maxParallelInput.value).toBe("0");
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
    expect(inputs.length).toBe(4);

    const maxParallelInput = inputs[1].element as HTMLInputElement;
    const progressIntervalInput = inputs[2].element as HTMLInputElement;
    const metricsIntervalInput = inputs[3].element as HTMLInputElement;

    expect(maxParallelInput.value).toBe("4");
    expect(progressIntervalInput.value).toBe("500");
    expect(metricsIntervalInput.value).toBe("2000");

    wrapper.unmount();
  });
});
