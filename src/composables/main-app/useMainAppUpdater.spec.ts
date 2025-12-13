// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";

import type { AppSettings } from "@/types";
import { buildSmartScanDefaults } from "@/__tests__/helpers/smartScanDefaults";
import { useMainAppUpdater } from "./useMainAppUpdater";

const relaunchMock = vi.fn(async (..._args: any[]) => {});
const checkMock = vi.fn(async (..._args: any[]) => null as any);
const fetchCapabilitiesMock = vi.fn(async () => ({ configured: true }));
const saveAppSettingsMock = vi.fn(async (settings: AppSettings) => settings);

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  fetchAppUpdaterCapabilities: (...args: any[]) => fetchCapabilitiesMock(...args),
  saveAppSettings: (...args: any[]) => saveAppSettingsMock(...args),
}));

const makeSettings = (): AppSettings => ({
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
});

describe("useMainAppUpdater", () => {
  beforeEach(() => {
    relaunchMock.mockReset();
    checkMock.mockReset();
    fetchCapabilitiesMock.mockReset();
    saveAppSettingsMock.mockReset();
  });

  it("manual check populates update metadata and persists into app settings", async () => {
    const downloadAndInstall = vi.fn(async (_cb?: any) => {});
    const close = vi.fn(async () => {});
    checkMock.mockResolvedValueOnce({
      version: "0.2.0",
      currentVersion: "0.1.1",
      downloadAndInstall,
      close,
    });

    const scheduleSaveSettings = vi.fn();

    const Comp = defineComponent({
      setup() {
        const appSettings = ref<AppSettings | null>(makeSettings());
        const updater = useMainAppUpdater({ appSettings, scheduleSaveSettings });
        return { appSettings, ...updater };
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await (wrapper.vm as any).checkForAppUpdate({ force: true });

    expect((wrapper.vm as any).updateAvailable).toBe(true);
    expect((wrapper.vm as any).availableVersion).toBe("0.2.0");
    expect((wrapper.vm as any).currentVersion).toBe("0.1.1");
    expect(scheduleSaveSettings).toHaveBeenCalled();

    const settings = (wrapper.vm as any).appSettings as AppSettings;
    expect((settings as any).updater?.availableVersion).toBe("0.2.0");
    expect(typeof (settings as any).updater?.lastCheckedAtMs).toBe("number");

    wrapper.unmount();
  });

  it("install calls updater downloadAndInstall then relaunch", async () => {
    const downloadAndInstall = vi.fn(async (_cb?: any) => {});
    const close = vi.fn(async () => {});
    checkMock.mockResolvedValueOnce({
      version: "0.2.0",
      currentVersion: "0.1.1",
      downloadAndInstall,
      close,
    });

    const Comp = defineComponent({
      setup() {
        const appSettings = ref<AppSettings | null>(makeSettings());
        const updater = useMainAppUpdater({
          appSettings,
          scheduleSaveSettings: vi.fn(),
        });
        return { appSettings, ...updater };
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await (wrapper.vm as any).checkForAppUpdate({ force: true });
    await (wrapper.vm as any).downloadAndInstallUpdate();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);
    expect((wrapper.vm as any).updateAvailable).toBe(false);
    expect((wrapper.vm as any).availableVersion).toBeNull();
    expect(relaunchMock).toHaveBeenCalledTimes(1);

    const settings = (wrapper.vm as any).appSettings as AppSettings;
    expect((settings as any).updater?.availableVersion).toBeUndefined();
    expect(typeof (settings as any).updater?.lastCheckedAtMs).toBe("number");

    wrapper.unmount();
  });

  it("install forces a fresh check when only cached metadata is present", async () => {
    const downloadAndInstall = vi.fn(async (_cb?: any) => {});
    const close = vi.fn(async () => {});
    checkMock.mockResolvedValueOnce({
      version: "0.2.0",
      currentVersion: "0.1.1",
      downloadAndInstall,
      close,
    });

    const scheduleSaveSettings = vi.fn();

    const Comp = defineComponent({
      setup() {
        const appSettings = ref<AppSettings | null>({
          ...makeSettings(),
          updater: {
            autoCheck: true,
            lastCheckedAtMs: Date.now() - 1000,
            availableVersion: "0.2.0",
          },
        });
        const updater = useMainAppUpdater({ appSettings, scheduleSaveSettings });
        return { appSettings, ...updater };
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await (wrapper.vm as any).downloadAndInstallUpdate();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);

    const settings = (wrapper.vm as any).appSettings as AppSettings;
    expect((settings as any).updater?.availableVersion).toBeUndefined();

    wrapper.unmount();
  });
});
