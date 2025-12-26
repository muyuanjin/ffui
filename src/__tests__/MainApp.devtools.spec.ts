// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import en from "@/locales/en";
import SettingsPanel from "@/components/panels/SettingsPanel.vue";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

const openDevtoolsMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      onDragDropEvent: vi.fn(async () => () => {}),
      show: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => () => {}),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => {
  return {
    openPath: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn(),
    convertFileSrc: (path: string) => path,
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  const loadAppSettings = vi.fn(async () => ({
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
  }));

  return {
    ...actual,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision ? `${path}?ffuiPreviewRev=${revision}` : path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({ overall: 0, perCore: [] })),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({ available: false })),
    loadAppSettings,
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
    openDevtools: (...args: any[]) => openDevtoolsMock(...args),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

describe("MainApp devtools quick action", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    openDevtoolsMock.mockClear();
  });

  it("calls backend openDevtools when the button is clicked (tauri)", async () => {
    const wrapper = mount(SettingsPanel, {
      props: {
        appSettings: {
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
        } as any,
        toolStatuses: [],
        toolStatusesFresh: true,
        isSavingSettings: false,
        settingsSaveError: null,
        fetchToolCandidates: async () => [],
      },
      global: {
        plugins: [i18n],
      },
    });

    const button = wrapper.get('[data-testid="settings-open-devtools"]');
    await button.trigger("click");

    expect(openDevtoolsMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
