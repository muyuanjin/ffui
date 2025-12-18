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
  taskbarProgressMode: "byEstimatedTime",
  queuePersistenceMode: "none",
});

describe("SettingsPanel queue persistence settings", () => {
  it("renders persisted CrashRecoveryFull retention values when appSettings is loaded", () => {
    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: {
          ...makeAppSettings(),
          queuePersistenceMode: "crashRecoveryFull",
          crashRecoveryLogRetention: { maxFiles: 321, maxTotalMb: 2048 },
        },
        toolStatuses: [] as ExternalToolStatus[],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const hint = wrapper.find('[data-testid="queue-persistence-full-hint"]');
    expect(hint.exists()).toBe(true);

    const retentionInputs = hint.findAll('input[type="number"]');
    expect(retentionInputs.length).toBe(2);
    expect((retentionInputs[0].element as HTMLInputElement).value).toBe("321");
    expect((retentionInputs[1].element as HTMLInputElement).value).toBe("2048");

    wrapper.unmount();
  });

  it("shows the full-mode warning and persists retention limits when CrashRecoveryFull is selected", async () => {
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

    expect(wrapper.find('[data-testid="queue-persistence-full-hint"]').exists()).toBe(false);

    await wrapper.find("#queue-persistence-crash-recovery-full").trigger("click");

    const emitted = wrapper.emitted("update:appSettings");
    expect(emitted?.length).toBe(1);

    const nextSettings = emitted?.[0]?.[0] as AppSettings;
    expect(nextSettings.queuePersistenceMode).toBe("crashRecoveryFull");

    await wrapper.setProps({ appSettings: nextSettings });
    const hint = wrapper.find('[data-testid="queue-persistence-full-hint"]');
    expect(hint.exists()).toBe(true);

    const retentionInputs = hint.findAll('input[type="number"]');
    expect(retentionInputs.length).toBe(2);

    expect((retentionInputs[0].element as HTMLInputElement).value).toBe("200");
    expect((retentionInputs[1].element as HTMLInputElement).value).toBe("512");

    await retentionInputs[1].setValue("1024");

    const emittedAfter = wrapper.emitted("update:appSettings") ?? [];
    const last = emittedAfter[emittedAfter.length - 1]?.[0] as AppSettings;
    expect(last.crashRecoveryLogRetention?.maxTotalMb).toBe(1024);

    wrapper.unmount();
  });
});
