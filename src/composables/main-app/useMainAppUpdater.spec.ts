// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";

import type { AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "@/__tests__/helpers/batchCompressDefaults";
import { useMainAppUpdater } from "./useMainAppUpdater";

const relaunchMock = vi.fn(async (..._args: any[]) => {});
const checkMock = vi.fn(async (..._args: any[]) => null as any);
const getVersionMock = vi.fn(async (..._args: any[]) => "0.1.1");
const fetchCapabilitiesMock = vi.fn(async (..._args: any[]) => ({ configured: true }));
const prepareAppUpdaterProxyMock = vi.fn(async (..._args: any[]) => null as any);
const saveAppSettingsMock = vi.fn(async (...args: any[]) => args[0] as AppSettings);

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const waitFor = async (predicate: () => boolean, label: string) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1500) {
      throw new Error(`Timed out waiting for: ${label}`);
    }
    await flushPromises();
  }
};

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: any[]) => getVersionMock(...args),
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  fetchAppUpdaterCapabilities: (...args: any[]) => fetchCapabilitiesMock(...args),
  prepareAppUpdaterProxy: (...args: any[]) => prepareAppUpdaterProxyMock(...args),
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
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  taskbarProgressMode: "byEstimatedTime",
});

describe("useMainAppUpdater", () => {
  beforeEach(() => {
    relaunchMock.mockReset();
    checkMock.mockReset();
    getVersionMock.mockReset();
    fetchCapabilitiesMock.mockReset();
    prepareAppUpdaterProxyMock.mockReset();
    saveAppSettingsMock.mockReset();
    getVersionMock.mockResolvedValue("0.1.1");
  });

  it("manual check populates update metadata and persists into app settings", async () => {
    const downloadAndInstall = vi.fn(async (_cb?: any) => {});
    const close = vi.fn(async () => {});
    prepareAppUpdaterProxyMock.mockResolvedValueOnce("http://127.0.0.1:7890");
    checkMock.mockResolvedValueOnce({
      version: "0.2.0",
      currentVersion: "0.1.1",
      body: "# FFUI v0.2.0\n\n## English\n\n### Highlights\n\n- Something new\n",
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

    expect(prepareAppUpdaterProxyMock).toHaveBeenCalledTimes(1);
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(checkMock).toHaveBeenCalledWith({ proxy: "http://127.0.0.1:7890" });
    expect(prepareAppUpdaterProxyMock.mock.invocationCallOrder[0]).toBeLessThan(checkMock.mock.invocationCallOrder[0]);

    expect((wrapper.vm as any).updateAvailable).toBe(true);
    expect((wrapper.vm as any).availableVersion).toBe("0.2.0");
    expect((wrapper.vm as any).availableBody).toContain("### Highlights");
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
      body: "## English\n\n### Highlights\n\n- Item\n",
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

    expect(prepareAppUpdaterProxyMock).toHaveBeenCalledTimes(1);
    expect(prepareAppUpdaterProxyMock.mock.invocationCallOrder[0]).toBeLessThan(checkMock.mock.invocationCallOrder[0]);

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);
    expect((wrapper.vm as any).updateAvailable).toBe(false);
    expect((wrapper.vm as any).availableVersion).toBeNull();
    expect((wrapper.vm as any).availableBody).toBeNull();
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
      body: "## 中文\n\n### 重点更新\n\n- 新功能\n",
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

    expect(prepareAppUpdaterProxyMock).toHaveBeenCalledTimes(1);
    expect(prepareAppUpdaterProxyMock.mock.invocationCallOrder[0]).toBeLessThan(checkMock.mock.invocationCallOrder[0]);

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);

    const settings = (wrapper.vm as any).appSettings as AppSettings;
    expect((settings as any).updater?.availableVersion).toBeUndefined();

    wrapper.unmount();
  });

  it("clears cached availableVersion when current version is already updated", async () => {
    getVersionMock.mockResolvedValueOnce("0.2.0");
    const scheduleSaveSettings = vi.fn();

    const Comp = defineComponent({
      setup() {
        const appSettings = ref<AppSettings | null>(null);
        const updater = useMainAppUpdater({ appSettings, scheduleSaveSettings });
        return { appSettings, ...updater };
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await waitFor(
      () => (wrapper.vm as any).updaterConfigured === true && (wrapper.vm as any).currentVersion === "0.2.0",
      "updater configured + current version loaded",
    );

    (wrapper.vm as any).appSettings = {
      ...makeSettings(),
      updater: {
        lastCheckedAtMs: Date.now() - 1000,
        availableVersion: "0.2.0",
      },
    };

    await waitFor(() => scheduleSaveSettings.mock.calls.length > 0, "scheduleSaveSettings called for cache clear");
    await waitFor(() => (wrapper.vm as any).availableVersion == null, "cached availableVersion cleared");

    expect((wrapper.vm as any).currentVersion).toBe("0.2.0");
    expect((wrapper.vm as any).updateAvailable).toBe(false);
    expect((wrapper.vm as any).availableVersion).toBeNull();
    expect(scheduleSaveSettings).toHaveBeenCalled();

    const settings = (wrapper.vm as any).appSettings as AppSettings;
    expect((settings as any).updater?.availableVersion).toBeUndefined();

    wrapper.unmount();
  });

  it("keeps cached updateAvailable when cached version is newer than current", async () => {
    getVersionMock.mockResolvedValueOnce("0.2.0");
    const scheduleSaveSettings = vi.fn();

    const Comp = defineComponent({
      setup() {
        const appSettings = ref<AppSettings | null>(null);
        const updater = useMainAppUpdater({ appSettings, scheduleSaveSettings });
        return { appSettings, ...updater };
      },
      template: "<div />",
    });

    const wrapper = mount(Comp);
    await waitFor(
      () => (wrapper.vm as any).updaterConfigured === true && (wrapper.vm as any).currentVersion === "0.2.0",
      "updater configured + current version loaded",
    );

    (wrapper.vm as any).appSettings = {
      ...makeSettings(),
      updater: {
        lastCheckedAtMs: Date.now() - 1000,
        availableVersion: "0.2.1",
      },
    };

    await waitFor(() => (wrapper.vm as any).updateAvailable === true, "updateAvailable true from cached version");

    expect((wrapper.vm as any).currentVersion).toBe("0.2.0");
    expect((wrapper.vm as any).updateAvailable).toBe(true);
    expect((wrapper.vm as any).availableVersion).toBe("0.2.1");
    expect(scheduleSaveSettings).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
