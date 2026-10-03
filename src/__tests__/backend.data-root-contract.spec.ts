import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import {
  acknowledgeDataRootFallbackNotice,
  clearAllAppData,
  exportConfigBundle,
  fetchDataRootInfo,
  importConfigBundle,
  openDataRootDir,
  setDataRootMode,
} from "@/lib/backend";
import type { DataRootInfo } from "@/types";
import { settingsSnapshot } from "./helpers/settingsSnapshot";
import { buildWebFallbackAppSettings } from "@/composables/appSettingsWebFallback";
import { acceptSettingsSnapshot, saveAppSettings, subscribeSettingsReplacement } from "@/lib/backend.settings";

const makeDataRootInfo = (): DataRootInfo => ({
  desiredMode: "system",
  effectiveMode: "system",
  dataRoot: "/tmp/ffui",
  systemRoot: "/tmp/ffui",
  portableRoot: "/tmp/ffui",
  fallbackActive: false,
  fallbackNoticePending: false,
  switchPending: false,
});

describe("backend data root contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    const w = globalThis as any;
    w.window = w.window ?? {};
    w.window.__TAURI_IPC__ = {};
  });

  it("fetches data root info via get_data_root_info", async () => {
    const info = makeDataRootInfo();
    invokeMock.mockResolvedValueOnce(info);

    const loaded = await fetchDataRootInfo();
    expect(invokeMock).toHaveBeenCalledWith("get_data_root_info", {});
    expect(loaded).toEqual(info);
  });

  it("sets data root mode via set_data_root_mode", async () => {
    const info = makeDataRootInfo();
    invokeMock.mockResolvedValueOnce(info);

    await setDataRootMode("portable");
    expect(invokeMock).toHaveBeenCalledWith("set_data_root_mode", { mode: "portable" });
  });

  it("acknowledges fallback notice via acknowledge_data_root_fallback_notice", async () => {
    invokeMock.mockResolvedValueOnce(true);

    const ok = await acknowledgeDataRootFallbackNotice();
    expect(invokeMock).toHaveBeenCalledWith("acknowledge_data_root_fallback_notice", {});
    expect(ok).toBe(true);
  });

  it("opens data root via open_data_root_dir", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await openDataRootDir();
    expect(invokeMock).toHaveBeenCalledWith("open_data_root_dir", {});
  });

  it("exports config bundle via export_config_bundle", async () => {
    invokeMock.mockResolvedValueOnce({ path: "/tmp/out.json", presetCount: 0 });

    await exportConfigBundle(" /tmp/out.json ");
    expect(invokeMock).toHaveBeenCalledWith("export_config_bundle", {
      targetPath: "/tmp/out.json",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("target_path");
  });

  it("imports config bundle via import_config_bundle", async () => {
    invokeMock.mockResolvedValueOnce({ presetCount: 0, settings: settingsSnapshot(buildWebFallbackAppSettings()) });

    await importConfigBundle("/tmp/in.json");
    expect(invokeMock).toHaveBeenCalledWith("import_config_bundle", {
      sourcePath: "/tmp/in.json",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("source_path");
  });

  it("serializes an import and discards saves queued from the replaced settings generation", async () => {
    const baseline = buildWebFallbackAppSettings();
    acceptSettingsSnapshot(settingsSnapshot(baseline));
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const received: unknown[] = [];
    const unsubscribe = subscribeSettingsReplacement((settings) => received.push(settings));
    const importing = importConfigBundle("/tmp/in.json");
    const staleSave = saveAppSettings({ ...baseline, locale: "en" });
    await Promise.resolve();
    const imported = { ...baseline, locale: "zh-CN" };
    finish({ presetCount: 0, settings: settingsSnapshot(imported) });
    await importing;
    expect(await staleSave).toEqual(imported);
    expect(received).toEqual([imported]);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["import_config_bundle"]);
    invokeMock.mockResolvedValueOnce(settingsSnapshot({ ...imported, developerModeEnabled: true }));
    await saveAppSettings({ ...imported, developerModeEnabled: true });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "save_app_settings",
      expect.objectContaining({ baseSettings: imported, baseContentId: JSON.stringify(imported) }),
    );
    unsubscribe();
  });

  it("propagates failed configuration import without a fallback result", async () => {
    invokeMock.mockRejectedValueOnce(new Error("failed to atomically replace presets"));
    await expect(importConfigBundle("D:/configuration.json")).rejects.toThrow("failed to atomically replace presets");
    expect(invokeMock).toHaveBeenCalledWith("import_config_bundle", { sourcePath: "D:/configuration.json" });
  });

  it("clears app data via clear_all_app_data", async () => {
    invokeMock.mockResolvedValueOnce(settingsSnapshot(buildWebFallbackAppSettings()));

    await clearAllAppData();
    expect(invokeMock).toHaveBeenCalledWith("clear_all_app_data", {});
  });
});
