// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";

import en from "@/locales/en";
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
  };
});

import { cleanupPreviewCachesAsync } from "@/lib/backend";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
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

describe("SettingsPanel preview cache cleanup", () => {
  it("calls cleanupPreviewCachesAsync when clicking the cleanup button", async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    await wrapper.get('[data-testid="settings-cleanup-preview-cache"]').trigger("click");
    expect(cleanupPreviewCachesAsync).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("shows status feedback on the button without adding a new message row", async () => {
    const wrapper = mount(SettingsPanel, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const button = wrapper.get('[data-testid="settings-cleanup-preview-cache"]');
    expect(button.text()).toBe("Clean up");

    await button.trigger("click");
    await nextTick();

    // The notice text should no longer be rendered as an extra row inside the card.
    expect(wrapper.text()).not.toContain("Cleanup has been started in the background.");

    // Feedback should appear on the button itself.
    expect(button.text()).toBe("Started");

    wrapper.unmount();
  });
});
