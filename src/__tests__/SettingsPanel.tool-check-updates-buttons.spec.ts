// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
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
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
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

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: false,
    autoUpdate: false,
    downloaded: undefined,
    remoteVersionCache: undefined,
  },
  smartScanDefaults: buildSmartScanDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

describe("SettingsPanel external tools check updates button", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a check-updates button for every external tool and forwards to refreshToolStatuses", async () => {
    const toolStatuses: ExternalToolStatus[] = [
      {
        kind: "ffmpeg",
        resolvedPath: "C:/tools/ffmpeg.exe",
        source: "path",
        version: "ffmpeg version 6.0",
        updateAvailable: false,
        autoDownloadEnabled: false,
        autoUpdateEnabled: false,
        downloadInProgress: false,
      },
      {
        kind: "ffprobe",
        resolvedPath: "C:/tools/ffprobe.exe",
        source: "path",
        version: "ffprobe version 6.0",
        updateAvailable: false,
        autoDownloadEnabled: false,
        autoUpdateEnabled: false,
        downloadInProgress: false,
      },
      {
        kind: "avifenc",
        resolvedPath: "C:/tools/avifenc.exe",
        source: "path",
        version: "avifenc 1.3.0",
        updateAvailable: false,
        autoDownloadEnabled: false,
        autoUpdateEnabled: false,
        downloadInProgress: false,
      },
    ];

    const refreshToolStatuses = vi.fn(async () => {});

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses,
        refreshToolStatuses,
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    await flushPromises();
    refreshToolStatuses.mockClear();

    const ffmpegBtn = wrapper.get('[data-testid="tool-check-update-ffmpeg"]');
    const ffprobeBtn = wrapper.get('[data-testid="tool-check-update-ffprobe"]');
    const avifencBtn = wrapper.get('[data-testid="tool-check-update-avifenc"]');

    expect(ffmpegBtn.text()).toBe("检查更新");
    expect(ffprobeBtn.text()).toBe("检查更新");
    expect(avifencBtn.text()).toBe("检查更新");

    let resolveRefresh: () => void = () => {};
    refreshToolStatuses.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = () => resolve();
        }),
    );

    await avifencBtn.trigger("click");
    await flushPromises();

    expect(refreshToolStatuses).toHaveBeenCalledWith({
      remoteCheck: true,
      manualRemoteCheck: true,
    });
    expect(wrapper.get('[data-testid="tool-check-update-avifenc"]').text()).toBe("检查中…");
    expect(wrapper.get('[data-testid="tool-check-update-log-avifenc"]').text()).toContain(
      "开始检查更新",
    );

    resolveRefresh();
    await flushPromises();

    await wrapper.setProps({
      toolStatuses: toolStatuses.map((status) =>
        status.kind === "avifenc"
          ? {
              ...status,
              remoteVersion: "avifenc 1.3.0",
              updateAvailable: false,
            }
          : status,
      ),
    });
    await flushPromises();

    expect(wrapper.get('[data-testid="tool-check-update-avifenc"]').text()).toBe("已检查");
    expect(wrapper.text().match(/已检查/g)?.length ?? 0).toBe(1);
    expect(wrapper.get('[data-testid="tool-check-update-log-avifenc"]').text()).toContain(
      "结论：已是最新版本",
    );

    wrapper.unmount();
  });

  it("shows a timeout log when no status snapshot arrives", async () => {
    vi.useFakeTimers();

    const toolStatuses: ExternalToolStatus[] = [
      {
        kind: "ffmpeg",
        resolvedPath: "C:/tools/ffmpeg.exe",
        source: "path",
        version: "ffmpeg version 6.0",
        updateAvailable: false,
        autoDownloadEnabled: false,
        autoUpdateEnabled: false,
        downloadInProgress: false,
      },
    ];

    const refreshToolStatuses = vi.fn(async () => {});

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses,
        refreshToolStatuses,
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    await vi.runOnlyPendingTimersAsync();
    refreshToolStatuses.mockClear();

    await wrapper.get('[data-testid="tool-check-update-ffmpeg"]').trigger("click");
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.runOnlyPendingTimersAsync();

    expect(wrapper.get('[data-testid="tool-check-update-log-ffmpeg"]').text()).toContain(
      "等待状态快照超时",
    );
    expect(wrapper.text()).not.toContain("已检查");

    wrapper.unmount();
  });
});
