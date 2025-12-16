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
    ensureOpenSourceFontDownloaded: vi.fn(async () => ({ id: "inter", familyName: "Inter", path: "/tmp/Inter.ttf", format: "ttf" })),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => {
      // Return unlisten noop
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
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

describe("SettingsPanel external tool download status", () => {
  it("renders download progress, bytes and speed for a tool in progress", () => {
    const toolStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "download",
      version: "ffmpeg version 6.0",
      updateAvailable: false,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: true,
      downloadProgress: 42.5,
      downloadedBytes: 5 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      bytesPerSecond: 2.5 * 1024 * 1024,
      lastDownloadError: undefined,
      lastDownloadMessage: undefined,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [toolStatus],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const text = wrapper.text();

    // Badge text should stay on a single line; we enforce this via a
    // whitespace-nowrap class.
    const readyBadge = wrapper.get("span.whitespace-nowrap");
    expect(readyBadge.text()).toBe("已就绪");

    // Progress percentage and byte counters are visible for the in-progress tool.
    expect(text).toContain("42.5%");
    expect(text).toContain("5.0 MB");
    expect(text).toContain("10.0 MB");
    expect(text).toContain("MB/s");
    // Fallback status message is used when no custom localized message exists.
    expect(text).toContain("正在下载，请稍候");

    wrapper.unmount();
  });

  it("does not show misleading 0 B when a download has just started and uses an indeterminate bar", () => {
    const toolStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "download",
      version: "ffmpeg version 6.0",
      updateAvailable: false,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: true,
      downloadProgress: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      bytesPerSecond: undefined,
      lastDownloadError: undefined,
      lastDownloadMessage: "starting auto-download for ffmpeg",
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [toolStatus],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const text = wrapper.text();
    // No explicit "0 B" should be rendered at the start of a download.
    expect(text).not.toContain("0 B");

    // The inner progress bar should render as an indeterminate, full-width
    // animated bar to indicate activity without a fake percentage.
    const bar = wrapper.get(".h-1.bg-muted\\/50 .h-full");
    const barClasses = bar.attributes("class") ?? "";
    expect(barClasses).toContain("animate-pulse");
    expect(barClasses).toContain("w-full");

    wrapper.unmount();
  });

  it("surfaces last download error instead of an update hint when the downloaded binary is not usable", () => {
    const toolStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: undefined,
      source: "download",
      version: "ffmpeg version 6.0",
      remoteVersion: "6.0",
      updateAvailable: true,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: false,
      downloadProgress: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      bytesPerSecond: undefined,
      lastDownloadError: "some error message from backend",
      lastDownloadMessage: undefined,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [toolStatus],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("some error message from backend");
    // 当存在明确的错误信息时，不再显示“检测到可用更新”这类模糊提示。
    expect(text).not.toContain("检测到可用更新");

    wrapper.unmount();
  });

  it("shows an explicit up-to-date hint and hides the 下载/更新 button when no update is available and the tool is ready", () => {
    const toolStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "download",
      version: "ffmpeg version 6.0",
      remoteVersion: "6.0",
      updateAvailable: false,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: false,
      downloadProgress: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      bytesPerSecond: undefined,
      lastDownloadError: undefined,
      lastDownloadMessage: undefined,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [toolStatus],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("已是最新版本");

    expect(wrapper.find("[data-testid=\"tool-download-action\"]").exists()).toBe(false);

    wrapper.unmount();
  });

  it("surfaces the backend-provided remote version in the update hint", () => {
    const toolStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "download",
      version: "ffmpeg version 6.0",
      remoteVersion: "6.1.1",
      updateAvailable: true,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: false,
      downloadProgress: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      bytesPerSecond: undefined,
      lastDownloadError: undefined,
      lastDownloadMessage: undefined,
    };

    const wrapper = mount(SettingsPanel, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [toolStatus],
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
    });

    const text = wrapper.text();
    expect(text).toContain("检测到可用更新：6.1.1");

    wrapper.unmount();
  });
});
