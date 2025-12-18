// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick, ref } from "vue";

import zhCN from "@/locales/zh-CN";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import type { AppSettings } from "@/types";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
    importUiFontFile: vi.fn(async () => ({
      id: "imported",
      familyName: "Imported",
      path: "/tmp/Imported.ttf",
      format: "ttf",
    })),
  };
});

vi.mock("@/lib/uiFonts", () => {
  return {
    applyDownloadedUiFont: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: vi.fn(async () => null),
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
  uiScalePercent: 125,
  uiFontSizePercent: 140,
  uiFontFamily: "system",
  uiFontName: "Example Font",
});

describe("SettingsAppearanceSection reset UI appearance", () => {
  it("resets appearance settings in a single update", async () => {
    const settings = ref<AppSettings>(makeAppSettings());
    const updates: AppSettings[] = [];

    const Host = defineComponent({
      components: { SettingsAppearanceSection },
      setup() {
        const update = (next: AppSettings) => {
          updates.push(next);
          settings.value = next;
        };
        return { settings, update };
      },
      template: `<SettingsAppearanceSection :app-settings="settings" @update:app-settings="update" />`,
    });

    const wrapper = mount(Host, {
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.find('[data-testid="settings-ui-system-font-input"]').exists()).toBe(true);

    await wrapper.find('[data-testid="settings-reset-ui-appearance"]').trigger("click");
    await nextTick();

    const finalSettings = settings.value;

    expect(updates.length).toBe(1);
    expect(finalSettings.uiScalePercent).toBe(100);
    expect(finalSettings.uiFontSizePercent).toBe(100);
    expect(finalSettings.uiFontFamily).toBe("system");
    expect(finalSettings.uiFontName).toBeUndefined();
    expect(finalSettings.uiFontDownloadId).toBeUndefined();
    expect(finalSettings.uiFontFilePath).toBeUndefined();
    expect(finalSettings.uiFontFileSourceName).toBeUndefined();

    expect(wrapper.find('[data-testid="settings-ui-system-font-input"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
