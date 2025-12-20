// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import SettingsDataStorageSection from "@/components/panels/SettingsDataStorageSection.vue";
import en from "@/locales/en";
import type { DataRootInfo } from "@/types";

const fetchDataRootInfo = vi.fn();
const setDataRootMode = vi.fn();
const acknowledgeDataRootFallbackNotice = vi.fn();
const openDataRootDir = vi.fn();
const exportConfigBundle = vi.fn();
const importConfigBundle = vi.fn();
const clearAllAppData = vi.fn();

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    fetchDataRootInfo: (...args: any[]) => fetchDataRootInfo(...args),
    setDataRootMode: (...args: any[]) => setDataRootMode(...args),
    acknowledgeDataRootFallbackNotice: (...args: any[]) => acknowledgeDataRootFallbackNotice(...args),
    openDataRootDir: (...args: any[]) => openDataRootDir(...args),
    exportConfigBundle: (...args: any[]) => exportConfigBundle(...args),
    importConfigBundle: (...args: any[]) => importConfigBundle(...args),
    clearAllAppData: (...args: any[]) => clearAllAppData(...args),
    loadAppSettings: vi.fn(async () => ({})),
  };
});

const openDialog = vi.fn();
const saveDialog = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: (...args: any[]) => openDialog(...args),
    save: (...args: any[]) => saveDialog(...args),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

const makeInfo = (overrides: Partial<DataRootInfo> = {}): DataRootInfo => ({
  desiredMode: "system",
  effectiveMode: "system",
  dataRoot: "/tmp/ffui",
  systemRoot: "/tmp/ffui",
  portableRoot: "/tmp/ffui",
  fallbackActive: false,
  fallbackNoticePending: false,
  switchPending: false,
  ...overrides,
});

describe("SettingsDataStorageSection", () => {
  beforeEach(() => {
    fetchDataRootInfo.mockReset();
    setDataRootMode.mockReset();
    acknowledgeDataRootFallbackNotice.mockReset();
    openDataRootDir.mockReset();
    exportConfigBundle.mockReset();
    importConfigBundle.mockReset();
    clearAllAppData.mockReset();
    openDialog.mockReset();
    saveDialog.mockReset();
  });

  it("renders and dismisses the fallback notice", async () => {
    fetchDataRootInfo.mockResolvedValueOnce(makeInfo({ fallbackNoticePending: true }));
    acknowledgeDataRootFallbackNotice.mockResolvedValueOnce(true);

    const wrapper = mount(SettingsDataStorageSection, {
      global: { plugins: [i18n] },
      props: {},
    });

    await flushPromises();

    expect(wrapper.find('[data-testid="settings-data-root-fallback-notice"]').exists()).toBe(true);
    await wrapper.get('[data-testid="settings-data-root-fallback-dismiss"]').trigger("click");
    await flushPromises();

    expect(acknowledgeDataRootFallbackNotice).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="settings-data-root-fallback-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not emit updates when import fails", async () => {
    fetchDataRootInfo.mockResolvedValueOnce(makeInfo());
    openDialog.mockResolvedValueOnce("/tmp/config.json");
    importConfigBundle.mockRejectedValueOnce(new Error("bad bundle"));

    const wrapper = mount(SettingsDataStorageSection, {
      global: { plugins: [i18n] },
      props: {},
    });

    await flushPromises();
    await wrapper.get('[data-testid="settings-data-root-import"]').trigger("click");
    await flushPromises();

    expect(importConfigBundle).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:appSettings")).toBeUndefined();
    wrapper.unmount();
  });
});
