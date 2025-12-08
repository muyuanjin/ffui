// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import SettingsExternalToolsSection from "@/components/panels/SettingsExternalToolsSection.vue";
import zhCN from "@/locales/zh-CN";
import type {
  AppSettings,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
} from "@/types";
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

const makeToolStatus = (kind: ExternalToolKind): ExternalToolStatus => ({
  kind,
  resolvedPath: `C:/tools/${kind}.exe`,
  source: "path",
  version: "ffmpeg version 6.0",
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

describe("SettingsExternalToolsSection candidate loading", () => {
  it("caches per-tool candidates, ignores stale results, and renders Everything SDK badges", async () => {
    const resolvers: Partial<
      Record<ExternalToolKind, (value: ExternalToolCandidate[]) => void>
    > = {};
    const fetchToolCandidates = vi.fn(
      (kind: ExternalToolKind) =>
        new Promise<ExternalToolCandidate[]>((resolve) => {
          resolvers[kind] = resolve;
        }),
    );

    const wrapper = mount(SettingsExternalToolsSection, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [makeToolStatus("ffmpeg"), makeToolStatus("ffprobe")],
        fetchToolCandidates,
      },
    });

    const candidateButtons = wrapper
      .findAll("button")
      .filter((btn) => btn.text() === "选择已检测路径…");
    expect(candidateButtons).toHaveLength(2);

    // Start loading ffmpeg candidates, then quickly switch to ffprobe so
    // ffprobe becomes the active kind while the first request is in flight.
    await candidateButtons[0].trigger("click");
    await candidateButtons[1].trigger("click");

    resolvers.ffprobe?.([
      {
        kind: "ffprobe",
        path: "C:/everything/ffprobe.exe",
        source: "everything",
        version: undefined,
        isCurrent: false,
      },
    ]);
    await flushPromises();

    // Everything SDK badge should be shown for the ffprobe candidate, and it
    // should be the only list rendered after fast switching.
    expect(wrapper.text()).toContain("Everything SDK");
    expect(wrapper.text()).toContain("C:/everything/ffprobe.exe");

    // Resolve the earlier ffmpeg request; the stale response must not replace
    // the currently focused ffprobe list.
    resolvers.ffmpeg?.([
      {
        kind: "ffmpeg",
        path: "C:/system/ffmpeg.exe",
        source: "path",
        version: undefined,
        isCurrent: false,
      },
    ]);
    await flushPromises();

    const textAfterStale = wrapper.text();
    expect(textAfterStale).toContain("C:/everything/ffprobe.exe");
    expect(textAfterStale).not.toContain("C:/system/ffmpeg.exe");

    // Clicking ffprobe again should reuse the cached snapshot instead of
    // issuing another heavy discovery call.
    await candidateButtons[1].trigger("click");
    await flushPromises();
    expect(fetchToolCandidates).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });
});
