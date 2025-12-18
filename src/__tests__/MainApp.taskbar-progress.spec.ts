// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import { acknowledgeTaskbarProgress } from "@/lib/backend";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

const focusListenMock = vi.fn<(event: string, handler: () => void) => Promise<() => void>>();

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      show: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      listen: (...args: Parameters<typeof focusListenMock>) => focusListenMock(...args),
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => () => {}),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  const acknowledgeTaskbarProgress = vi.fn(async () => {});

  return {
    ...actual,
    acknowledgeTaskbarProgress,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({ overall: 0, perCore: [] })),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({ available: false })),
    loadAppSettings: vi.fn(async () => ({
      tools: {
        ffmpegPath: undefined,
        ffprobePath: undefined,
        avifencPath: undefined,
        autoDownload: false,
        autoUpdate: false,
      },
      batchCompressDefaults: buildBatchCompressDefaults(),
      previewCapturePercent: 25,
      defaultQueuePresetId: undefined,
      maxParallelJobs: undefined,
      progressUpdateIntervalMs: undefined,
      taskbarProgressMode: "byEstimatedTime",
    })),
    loadPresets: vi.fn(async () => []),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadPreviewDataUrl: vi.fn(async () => ""),
    runAutoCompress: vi.fn(async () => ({
      rootPath: "",
      jobs: [],
      totalFilesScanned: 0,
      totalCandidates: 0,
      totalProcessed: 0,
      batchId: "test-batch",
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
    })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    savePresetOnBackend: vi.fn(async (preset: any) => [preset]),
    deletePresetOnBackend: vi.fn(async () => []),
    enqueueTranscodeJob: vi.fn(async () => ({}) as any),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainApp taskbar progress acknowledgement", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    focusListenMock.mockReset();
    (acknowledgeTaskbarProgress as any).mockReset?.();
  });

  it("registers a focus listener and calls acknowledgeTaskbarProgress on tauri://focus", async () => {
    let focusHandler: (() => void) | null = null;

    focusListenMock.mockImplementation(async (event: string, handler: () => void) => {
      if (event === "tauri://focus") {
        focusHandler = handler;
      }
      return () => {};
    });

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    await nextTick();

    expect(focusListenMock).toHaveBeenCalledTimes(1);
    expect(focusListenMock.mock.calls[0][0]).toBe("tauri://focus");
    expect(typeof focusHandler).toBe("function");

    // Simulate the window gaining focus after a completed run.
    if (focusHandler) {
      (focusHandler as () => void)();
    }

    expect(acknowledgeTaskbarProgress).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
