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

const makeAppSettings = (overrides: Partial<AppSettings["tools"]> = {}): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
    ...overrides,
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

describe("SettingsPanel external tools management modes", () => {
  it("renders three named modes with a recommended badge for the default combo", () => {
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

    const radios = wrapper.findAll('input[type="radio"][name="external-tools-mode"]');
    expect(radios.length).toBe(3);

    const first = radios[0].element as HTMLInputElement;
    const second = radios[1].element as HTMLInputElement;
    const third = radios[2].element as HTMLInputElement;

    // Default combo (autoDownload=true, autoUpdate=true) should select the first mode.
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(false);
    expect(third.checked).toBe(false);

    const text = wrapper.text();
    expect(text).toContain("自动托管");
    expect(text).toContain("缺时安装");
    expect(text).toContain("手动管理");
    expect(text).toContain("推荐");

    // Custom hint must not be shown for canonical combinations.
    expect(wrapper.find('[data-testid="tools-mode-custom-hint"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("maps the three modes to the expected autoDownload / autoUpdate combinations", async () => {
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

    const radios = wrapper.findAll('input[type="radio"][name="external-tools-mode"]');
    expect(radios.length).toBe(3);

    // Switch to "缺时安装" (install-only): autoDownload=true, autoUpdate=false
    await radios[1].trigger("change");
    const emitted1 = wrapper.emitted("update:appSettings");
    expect(emitted1).toBeTruthy();
    const firstPayload = emitted1![0][0] as AppSettings;
    expect(firstPayload.tools.autoDownload).toBe(true);
    expect(firstPayload.tools.autoUpdate).toBe(false);

    // Switch to "手动管理": autoDownload=false, autoUpdate=false
    await radios[2].trigger("change");
    const emitted2 = wrapper.emitted("update:appSettings");
    expect(emitted2).toBeTruthy();
    const secondPayload = emitted2![1][0] as AppSettings;
    expect(secondPayload.tools.autoDownload).toBe(false);
    expect(secondPayload.tools.autoUpdate).toBe(false);

    wrapper.unmount();
  });

  it("surfaces legacy or advanced combinations as a custom mode hint", () => {
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings({ autoDownload: false, autoUpdate: true }),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const radios = wrapper.findAll('input[type="radio"][name="external-tools-mode"]');
    expect(radios.length).toBe(3);

    const first = radios[0].element as HTMLInputElement;
    const second = radios[1].element as HTMLInputElement;
    const third = radios[2].element as HTMLInputElement;

    // No canonical mode matches this combination; all radios should be unselected.
    expect(first.checked).toBe(false);
    expect(second.checked).toBe(false);
    expect(third.checked).toBe(false);

    const customHint = wrapper.find('[data-testid="tools-mode-custom-hint"]');
    expect(customHint.exists()).toBe(true);
    expect(customHint.text()).toContain("自定义模式");

    wrapper.unmount();
  });
});
