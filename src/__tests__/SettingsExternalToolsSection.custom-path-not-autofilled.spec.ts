// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import SettingsExternalToolsSection from "@/components/panels/SettingsExternalToolsSection.vue";
import zhCN from "@/locales/zh-CN";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

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
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

const makeFfprobeStatus = (): ExternalToolStatus => ({
  kind: "ffprobe",
  resolvedPath: "C:/tools/ffprobe.exe",
  source: "download",
  version: "ffprobe version 6.0",
  remoteVersion: undefined,
  updateCheckResult: "unknown",
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
  lastRemoteCheckError: undefined,
  lastRemoteCheckMessage: undefined,
  lastRemoteCheckAtMs: undefined,
});

describe("SettingsExternalToolsSection custom path binding", () => {
  it("does not auto-fill CUSTOM from resolvedPath when ffprobePath is unset", () => {
    const wrapper = mount(SettingsExternalToolsSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [makeFfprobeStatus()],
        toolStatusesFresh: true,
        fetchToolCandidates: vi.fn(async () => []),
      },
    });

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(1);
    expect((inputs[0].element as HTMLInputElement).value).toBe("");

    wrapper.unmount();
  });
});
