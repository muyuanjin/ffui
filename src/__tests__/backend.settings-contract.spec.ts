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
import mediaOutputContract from "../../src-tauri/tests/output-media-policy-contract.json";
import type { OutputContainerPolicy } from "@/types/output-policy";
import type { OutputContainerPolicy as WireContainerPolicy } from "@/lib/backend/generated/queue-contracts";
import planningContract from "../../src-tauri/tests/preset-output-planning-contract.json";
import settingsMediaContract from "../../src-tauri/tests/settings-media-selection-contract.json";
import snapshotContract from "../../src-tauri/tests/settings-snapshot-contract.json";
import { settingsSnapshot } from "./helpers/settingsSnapshot";
import { acceptSettingsSnapshot } from "@/lib/backend.settings";

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
  vmafMeasureReferencePath: "D:/vmaf/samples/bbb1080p30s.mp4",
  presetCardFooter: {
    layout: "oneRow",
    showAvgSize: true,
    showFps: true,
    showVmaf: true,
    showUsedCount: true,
    showDataAmount: false,
    showThroughput: false,
  },
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
  it("consumes the Rust snapshot envelope and forwards its identities on save", async () => {
    const settings = makeAppSettings();
    invokeMock.mockResolvedValue({ ...snapshotContract, settings });
    await loadAppSettings();
    await saveAppSettings(settings);
    expect(invokeMock).toHaveBeenLastCalledWith("save_app_settings", {
      settings,
      baseSettings: settings,
      baseContentId: snapshotContract.contentId,
      dataRootId: snapshotContract.dataRootId,
    });
  });
  it("uses the confirmed document identity and protects the baseline from UI mutation", async () => {
    const initial = makeAppSettings();
    const confirmation = { ...settingsSnapshot(initial), contentId: "confirmed-revision-1" };
    invokeMock.mockResolvedValueOnce(confirmation);
    const draft = await loadAppSettings();
    draft.tools.autoDownload = false;
    const merged = { ...initial, locale: "zh-CN", tools: { ...initial.tools, autoDownload: false } };
    invokeMock.mockResolvedValueOnce({ ...settingsSnapshot(merged), contentId: "confirmed-revision-2" });
    expect(await saveAppSettings(draft)).toEqual(merged);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "save_app_settings",
      expect.objectContaining({
        baseContentId: "confirmed-revision-1",
        dataRootId: "test-data-root",
        baseSettings: expect.objectContaining({ tools: expect.objectContaining({ autoDownload: true }) }),
        settings: expect.objectContaining({ tools: expect.objectContaining({ autoDownload: false }) }),
      }),
    );
    invokeMock.mockResolvedValueOnce(settingsSnapshot(merged));
    await saveAppSettings({ ...merged, selectionBarPinned: false });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "save_app_settings",
      expect.objectContaining({ baseContentId: "confirmed-revision-2", baseSettings: merged }),
    );
  });

  it("rejects malformed snapshot responses instead of accepting unconfirmed settings", async () => {
    invokeMock.mockResolvedValueOnce(makeAppSettings());
    await expect(loadAppSettings()).rejects.toThrow("Invalid settings snapshot");
    invokeMock.mockResolvedValueOnce({
      ...settingsSnapshot(makeAppSettings()),
      unavailableSettings: [{ path: 1, reason: "bad" }],
    });
    await expect(loadAppSettings()).rejects.toThrow("Invalid settings snapshot");
  });

  it("retains the confirmed baseline after an IPC write failure", async () => {
    const baseline = makeAppSettings();
    acceptSettingsSnapshot({ ...settingsSnapshot(baseline), contentId: "before-failure" });
    invokeMock.mockRejectedValueOnce(new Error("atomic replacement denied"));
    await expect(saveAppSettings({ ...baseline, locale: "zh-CN" })).rejects.toThrow("atomic replacement denied");
    invokeMock.mockResolvedValueOnce(settingsSnapshot(baseline));
    await saveAppSettings(baseline);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "save_app_settings",
      expect.objectContaining({ baseContentId: "before-failure", baseSettings: baseline }),
    );
  });
  it("propagates settings load failure without saving a default configuration", async () => {
    invokeMock.mockRejectedValueOnce("settings file is not valid JSON");
    await expect(loadAppSettings()).rejects.toBe("settings file is not valid JSON");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["get_app_settings"]);
  });
  it("preserves the media defaults disk contract across settings IPC", async () => {
    const settings = { ...makeAppSettings(), ...settingsMediaContract } as AppSettings;
    acceptSettingsSnapshot(settingsSnapshot(settings));
    invokeMock.mockResolvedValue(settingsSnapshot(settings));
    expect(await saveAppSettings(settings)).toEqual(settings);
    expect(invokeMock).toHaveBeenLastCalledWith("save_app_settings", {
      settings,
      baseSettings: settings,
      baseContentId: JSON.stringify(settings),
      dataRootId: "test-data-root",
    });
    expect(await loadAppSettings()).toEqual(settings);
    expect(invokeMock).toHaveBeenLastCalledWith("get_app_settings", {});
  });
  it("persists per-input preset selection independently of a unified output format", async () => {
    const settings = makeAppSettings();
    settings.queuePresetSelection = planningContract.selection as AppSettings["queuePresetSelection"];
    settings.queueOutputPolicy!.container = { mode: "force", format: "mp3" };
    acceptSettingsSnapshot(settingsSnapshot(settings));
    invokeMock.mockResolvedValueOnce(settingsSnapshot(settings));
    expect(await saveAppSettings(settings)).toEqual(settings);
    expect(invokeMock).toHaveBeenCalledWith("save_app_settings", {
      settings,
      baseSettings: settings,
      baseContentId: JSON.stringify(settings),
      dataRootId: "test-data-root",
    });
    expect(settings.queueOutputPolicy!.container).toEqual({ mode: "force", format: "mp3" });
  });
  it("round trips per-media format fields without flattening them into one force format", async () => {
    const container = mediaOutputContract.container as OutputContainerPolicy;
    const wireContainer: WireContainerPolicy = container;
    expect(wireContainer).toEqual(mediaOutputContract.container);
    const settings = makeAppSettings();
    settings.queueOutputPolicy!.container = container;
    invokeMock.mockResolvedValue(settingsSnapshot(settings));
    expect((await loadAppSettings()).queueOutputPolicy?.container).toEqual(container);
    await saveAppSettings(settings);
    expect(invokeMock).toHaveBeenLastCalledWith("save_app_settings", {
      settings,
      baseSettings: settings,
      baseContentId: JSON.stringify(settings),
      dataRootId: "test-data-root",
    });
  });
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads app settings via get_app_settings", async () => {
    const settings = makeAppSettings();
    invokeMock.mockResolvedValueOnce(settingsSnapshot(settings));

    const loaded = await loadAppSettings();
    expect(invokeMock).toHaveBeenCalledWith("get_app_settings", {});
    expect(loaded).toEqual(settings);
  });

  it("saves app settings via save_app_settings and keeps crash recovery keys stable", async () => {
    const settings = makeAppSettings();
    acceptSettingsSnapshot(settingsSnapshot(settings));
    invokeMock.mockResolvedValueOnce(settingsSnapshot(settings));

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
        vmafMeasureReferencePath: "D:/vmaf/samples/bbb1080p30s.mp4",
        presetCardFooter: {
          layout: "oneRow",
          showAvgSize: true,
          showFps: true,
          showVmaf: true,
          showUsedCount: true,
          showDataAmount: false,
          showThroughput: false,
        },
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
