// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

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

describe("SettingsPanel network proxy settings", () => {
  it("defaults to system proxy when unset, supports switching to custom and clearing back to system", async () => {
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

    const radios = wrapper.findAll('input[type="radio"][name="settings-network-proxy-mode"]');
    expect(radios.length).toBe(3);

    const noneRadio = radios[0].element as HTMLInputElement;
    const systemRadio = radios[1].element as HTMLInputElement;
    const customRadio = radios[2].element as HTMLInputElement;
    expect(noneRadio.checked).toBe(false);
    expect(systemRadio.checked).toBe(true);
    expect(customRadio.checked).toBe(false);

    await radios[2].trigger("change");
    await nextTick();
    const emitted1 = wrapper.emitted("update:appSettings") ?? [];
    expect(emitted1.length).toBeGreaterThan(0);
    const afterCustom = emitted1[emitted1.length - 1]![0] as AppSettings;
    expect(afterCustom.networkProxy).toMatchObject({
      mode: "custom",
    });
    await wrapper.setProps({ appSettings: afterCustom });

    const proxyInput = wrapper
      .find('[data-testid="settings-network-proxy"]')
      .find("input[type='text'], input:not([type])");
    await proxyInput.setValue("http://127.0.0.1:7890");
    await proxyInput.trigger("blur");
    await nextTick();

    const emitted2 = wrapper.emitted("update:appSettings") ?? [];
    const last = emitted2[emitted2.length - 1]![0] as AppSettings;
    expect(last.networkProxy).toEqual({
      mode: "custom",
      proxyUrl: "http://127.0.0.1:7890",
    });
    await wrapper.setProps({ appSettings: last });

    await radios[1].trigger("change");
    await nextTick();
    const emitted3 = wrapper.emitted("update:appSettings") ?? [];
    const last2 = emitted3[emitted3.length - 1]![0] as AppSettings;
    expect(last2.networkProxy).toBeUndefined();

    wrapper.unmount();
  });
});
