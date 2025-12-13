import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<
  (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) =>
      invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { loadAppSettings, saveAppSettings } from "@/lib/backend";
import type { AppSettings } from "@/types";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  updater: {
    autoCheck: true,
    lastCheckedAtMs: 1_735_000_000_000,
    availableVersion: "0.2.0",
  },
  smartScanDefaults: buildSmartScanDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  taskbarProgressMode: "byEstimatedTime",
  queuePersistenceMode: "crashRecoveryFull",
  crashRecoveryLogRetention: {
    maxFiles: 10,
    maxTotalMb: 123,
  },
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
      },
    });
    expect(saved).toEqual(settings);
  });
});
