// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
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
  it("caches per-tool candidates, ignores stale results, renders Everything SDK badges, and toggles closed on repeat click", async () => {
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

    // Clicking ffprobe again should collapse the list without a new fetch.
    await candidateButtons[1].trigger("click");
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).not.toContain("C:/everything/ffprobe.exe");
    expect(fetchToolCandidates).toHaveBeenCalledTimes(2);

    // Clicking ffprobe after collapse should reopen using cached data without
    // firing a new fetch.
    await candidateButtons[1].trigger("click");
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain("C:/everything/ffprobe.exe");
    expect(fetchToolCandidates).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it("shows full path + file size on hover title and flips Use to Current after selecting a candidate", async () => {
    const fetchToolCandidates = vi.fn(
      async (_kind: ExternalToolKind): Promise<ExternalToolCandidate[]> => [
        {
          kind: "ffprobe",
          path: "C:/everything/ffprobe.exe",
          source: "everything",
          version: "ffprobe version 6.0",
          fileSizeBytes: 1024,
          isCurrent: false,
        },
      ]
    );

    const wrapper = mount(SettingsExternalToolsSection, {
      global: {
        plugins: [i18n],
      },
      props: {
        appSettings: makeAppSettings(),
        toolStatuses: [makeToolStatus("ffprobe")],
        fetchToolCandidates,
      },
    });

    const openButton = wrapper
      .findAll("button")
      .find((btn) => btn.text() === "选择已检测路径…");
    expect(openButton).toBeTruthy();
    await openButton!.trigger("click");
    await flushPromises();

    const pathEl = wrapper.find('[data-testid="tool-candidate-path-ffprobe-0"]');
    expect(pathEl.text()).toContain("C:/everything/ffprobe.exe");
    expect(pathEl.attributes("title")).toContain("C:/everything/ffprobe.exe");
    expect(pathEl.attributes("title")).toContain("大小: 1.0 KB");

    const useButton = wrapper
      .find('[data-testid="tool-candidate-ffprobe-0"]')
      .findAll("button")
      .find((btn) => btn.text() === "使用");
    expect(useButton).toBeTruthy();
    await useButton!.trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("当前");
    const emitted = wrapper.emitted("update:appSettings") ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    const last = emitted[emitted.length - 1]?.[0] as AppSettings;
    expect(last.tools.ffprobePath).toBe("C:/everything/ffprobe.exe");

    wrapper.unmount();
  });
});
