// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import SettingsExternalToolsSection from "@/components/panels/SettingsExternalToolsSection.vue";
import zhCN from "@/locales/zh-CN";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

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
    autoDownload: false,
    autoUpdate: false,
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

const makeMissingToolStatus = (): ExternalToolStatus => ({
  kind: "ffmpeg",
  resolvedPath: undefined,
  source: undefined,
  version: undefined,
  remoteVersion: undefined,
  updateAvailable: false,
  autoDownloadEnabled: false,
  autoUpdateEnabled: false,
  downloadInProgress: false,
  downloadProgress: undefined,
  downloadedBytes: undefined,
  totalBytes: undefined,
  bytesPerSecond: undefined,
  lastDownloadError: undefined,
  lastDownloadMessage: undefined,
});

describe("SettingsExternalToolsSection detecting status", () => {
  it("renders a 'detecting' badge before the first refreshed snapshot arrives", () => {
    const wrapper = mount(SettingsExternalToolsSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [makeMissingToolStatus()],
        toolStatusesFresh: false,
        fetchToolCandidates: vi.fn(async () => []),
      },
    });

    expect(wrapper.text()).toContain("检测中");

    wrapper.unmount();
  });
});

