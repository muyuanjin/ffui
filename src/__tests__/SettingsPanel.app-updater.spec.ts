// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import en from "@/locales/en";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    openDevtools: vi.fn(),
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
    ensureOpenSourceFontDownloaded: vi.fn(async () => ({ id: "inter", familyName: "Inter", path: "/tmp/Inter.ttf", format: "ttf" })),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

const makeAppSettings = (overrides: Partial<AppSettings> = {}): AppSettings =>
  ({
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
    taskbarProgressMode: "byEstimatedTime",
    ...overrides,
  }) as AppSettings;

describe("SettingsPanel app updater section", () => {
  it("calls the manual check handler with force=true", async () => {
    const checkForAppUpdate = vi.fn(async () => {});

    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
        appUpdate: {
          available: false,
          checking: false,
          installing: false,
          availableVersion: null,
          currentVersion: null,
          lastCheckedAtMs: null,
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
        },
        checkForAppUpdate,
      },
    });

    await wrapper.get('[data-testid="settings-check-updates"]').trigger("click");
    expect(checkForAppUpdate).toHaveBeenCalledWith({ force: true });
    wrapper.unmount();
  });

  it("shows install button when update is available and calls install handler", async () => {
    const installAppUpdate = vi.fn(async () => {});

    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
        appUpdate: {
          available: true,
          checking: false,
          installing: false,
          availableVersion: "0.2.0",
          currentVersion: "0.1.1",
          lastCheckedAtMs: null,
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
        },
        installAppUpdate,
      },
    });

    const btn = wrapper.get('[data-testid="settings-install-update"]');
    expect(btn.text().toLowerCase()).toContain("install");
    await btn.trigger("click");
    expect(installAppUpdate).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
