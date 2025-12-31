import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { loadAppSettings, saveAppSettings } from "@/lib/backend";
import type { AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  networkProxy: {
    mode: "custom",
    proxyUrl: "http://127.0.0.1:7890",
    fallbackToDirectOnError: true,
  },
  uiScalePercent: 110,
  uiFontSizePercent: 120,
  uiFontFamily: "system",
  uiFontName: "Consolas",
  uiFontDownloadId: "inter",
  uiFontFilePath: "/tmp/ui-fonts/imported.ttf",
  uiFontFileSourceName: "MyFont.ttf",
  updater: {
    autoCheck: true,
    lastCheckedAtMs: 1_735_000_000_000,
    availableVersion: "0.2.0",
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  presetSortMode: "name",
  presetViewMode: "compact",
  parallelismMode: "split",
  maxParallelJobs: 2,
  maxParallelCpuJobs: 3,
  maxParallelHwJobs: 1,
  selectionBarPinned: true,
  presetSelectionBarPinned: true,
  taskbarProgressMode: "byEstimatedTime",
  queueOutputPolicy: {
    container: { mode: "force", format: "mkv" },
    directory: { mode: "fixed", directory: "D:/outputs" },
    filename: {
      prefix: "PRE_",
      suffix: "_SUF",
      appendTimestamp: true,
      appendEncoderQuality: true,
      randomSuffixLen: 6,
      regexReplace: { pattern: "^video", replacement: "clip" },
    },
    preserveFileTimes: true,
  },
  queuePersistenceMode: "crashRecoveryFull",
  crashRecoveryLogRetention: {
    maxFiles: 10,
    maxTotalMb: 123,
  },
  onboardingCompleted: true,
});

describe("backend settings contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads app settings via get_app_settings", async () => {
    const settings = makeAppSettings();
    invokeMock.mockResolvedValueOnce(settings);

    const loaded = await loadAppSettings();
    expect(invokeMock).toHaveBeenCalledWith("get_app_settings", {});
    expect(loaded).toEqual(settings);
  });

  it("saves app settings via save_app_settings and keeps crash recovery keys stable", async () => {
    const settings = makeAppSettings();
    invokeMock.mockResolvedValueOnce(settings);

    const saved = await saveAppSettings(settings);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("save_app_settings");
    expect(payload).toMatchObject({
      settings: {
        networkProxy: {
          mode: "custom",
          proxyUrl: "http://127.0.0.1:7890",
          fallbackToDirectOnError: true,
        },
        presetSortMode: "name",
        presetViewMode: "compact",
        parallelismMode: "split",
        maxParallelJobs: 2,
        maxParallelCpuJobs: 3,
        maxParallelHwJobs: 1,
        selectionBarPinned: true,
        presetSelectionBarPinned: true,
        queueOutputPolicy: {
          container: { mode: "force", format: "mkv" },
          directory: { mode: "fixed", directory: "D:/outputs" },
          filename: {
            prefix: "PRE_",
            suffix: "_SUF",
            appendTimestamp: true,
            appendEncoderQuality: true,
            randomSuffixLen: 6,
            regexReplace: { pattern: "^video", replacement: "clip" },
          },
          preserveFileTimes: true,
        },
        updater: {
          autoCheck: true,
          lastCheckedAtMs: 1_735_000_000_000,
          availableVersion: "0.2.0",
        },
        queuePersistenceMode: "crashRecoveryFull",
        crashRecoveryLogRetention: {
          maxFiles: 10,
          maxTotalMb: 123,
        },
        onboardingCompleted: true,
      },
    });
    expect(saved).toEqual(settings);
  });
});
