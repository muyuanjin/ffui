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
      target_path: "/tmp/out.json",
    });
  });

  it("imports config bundle via import_config_bundle", async () => {
    invokeMock.mockResolvedValueOnce({ presetCount: 0, settings: {} });

    await importConfigBundle("/tmp/in.json");
    expect(invokeMock).toHaveBeenCalledWith("import_config_bundle", {
      sourcePath: "/tmp/in.json",
      source_path: "/tmp/in.json",
    });
  });

  it("clears app data via clear_all_app_data", async () => {
    invokeMock.mockResolvedValueOnce({});

    await clearAllAppData();
    expect(invokeMock).toHaveBeenCalledWith("clear_all_app_data", {});
  });
});
