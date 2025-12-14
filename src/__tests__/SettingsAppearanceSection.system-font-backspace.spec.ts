// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick, ref } from "vue";

import zhCN from "@/locales/zh-CN";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import type { AppSettings } from "@/types";
import { fetchSystemFontFamilies } from "@/lib/backend";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    fetchSystemFontFamilies: vi.fn(async () => []),
    listOpenSourceFonts: vi.fn(async () => []),
    importUiFontFile: vi.fn(async () => ({ id: "imported", familyName: "Imported", path: "/tmp/Imported.ttf", format: "ttf" })),
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
  uiScalePercent: 100,
  uiFontSizePercent: 100,
  uiFontFamily: "system",
  uiFontName: "Example Font",
});

describe("SettingsAppearanceSection system font input", () => {
  const fetchSystemFontFamiliesMock = vi.mocked(fetchSystemFontFamilies);

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSystemFontFamiliesMock.mockReset();
    fetchSystemFontFamiliesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the system font input visible when clearing text via backspace", async () => {
    const Host = defineComponent({
      components: { SettingsAppearanceSection },
      setup() {
        const settings = ref<AppSettings>(makeAppSettings());
        const update = (next: AppSettings) => {
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

    const input = wrapper.find('[data-testid="settings-ui-system-font-input"]');
    await input.setValue("");

    vi.advanceTimersByTime(350);
    await nextTick();

    expect(wrapper.find('[data-testid="settings-ui-system-font-input"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("keeps font suggestions working after selecting a suggestion and then editing again", async () => {
    fetchSystemFontFamiliesMock.mockResolvedValue([
      { primary: "Example Primary", names: ["示例字体", "Example Primary"] },
      { primary: "Other Font", names: ["其他字体", "Other Font"] },
    ]);

    const Host = defineComponent({
      components: { SettingsAppearanceSection },
      setup() {
        const settings = ref<AppSettings>(makeAppSettings());
        const update = (next: AppSettings) => {
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

    const input = wrapper.find('[data-testid="settings-ui-system-font-input"]');
    await input.trigger("focus");
    await Promise.resolve();
    await nextTick();

    await input.setValue("示例");
    await nextTick();
    expect(wrapper.find('[data-testid="settings-ui-system-font-suggestions"]').exists()).toBe(true);

    const suggestionButtons = wrapper.findAll('[data-testid="settings-ui-system-font-suggestions"] button');
    expect(suggestionButtons.length).toBeGreaterThan(0);
    await suggestionButtons[0]!.trigger("mousedown");
    await nextTick();

    expect(wrapper.find('[data-testid="settings-ui-system-font-suggestions"]').exists()).toBe(false);

    // Edit again without hitting refresh: suggestions should show up again.
    await input.setValue("其");
    await nextTick();
    expect(wrapper.find('[data-testid="settings-ui-system-font-suggestions"]').exists()).toBe(true);

    wrapper.unmount();
  });
});
