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

const makeAppSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
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
  ...overrides,
});

describe("SettingsPanel interval input UX", () => {
  it("lets the user clear the progress interval input without snapping to the default while editing", async () => {
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

    const progressIntervalInput = wrapper.get('input[data-testid="settings-progress-update-interval-ms"]');
    expect((progressIntervalInput.element as HTMLInputElement).value).toBe("250");

    await progressIntervalInput.setValue("");
    expect((progressIntervalInput.element as HTMLInputElement).value).toBe("");

    wrapper.unmount();
  });

  it("commits the progress interval on blur and clamps it to the allowed range", async () => {
    const onUpdate = vi.fn();
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings({ progressUpdateIntervalMs: 250 }),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
        "onUpdate:appSettings": onUpdate,
      },
    });

    onUpdate.mockClear();

    const progressIntervalInput = wrapper.get('input[data-testid="settings-progress-update-interval-ms"]');

    await progressIntervalInput.setValue("49");
    await progressIntervalInput.trigger("blur");

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const nextSettings = onUpdate.mock.calls[0]?.[0] as AppSettings;
    expect(nextSettings.progressUpdateIntervalMs).toBe(50);

    await wrapper.setProps({ appSettings: nextSettings });
    const refreshedProgressInput = wrapper.get('input[data-testid="settings-progress-update-interval-ms"]');
    expect((refreshedProgressInput.element as HTMLInputElement).value).toBe("50");

    wrapper.unmount();
  });

  it("keeps the STATUS row mounted to avoid layout shifts while saving toggles", async () => {
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

    expect(wrapper.text()).toContain("STATUS:");
    expect(wrapper.text()).toContain("READY");

    await wrapper.setProps({ isSavingSettings: true });
    expect(wrapper.text()).toContain("STATUS:");
    expect(wrapper.text()).toContain("SAVING...");

    await wrapper.setProps({ isSavingSettings: false });
    expect(wrapper.text()).toContain("STATUS:");
    expect(wrapper.text()).toContain("READY");

    wrapper.unmount();
  });
});
