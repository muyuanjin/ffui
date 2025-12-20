import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PresetBundle, PresetBundleExportResult } from "@/types";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { exportPresetsBundle, readPresetsBundle } from "./backend";

describe("backend contract - preset bundle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    const w = globalThis as any;
    w.window = w.window ?? {};
    w.window.__TAURI_IPC__ = {};
  });

  it("exportPresetsBundle calls export_presets_bundle with both camelCase and snake_case keys", async () => {
    const result: PresetBundleExportResult = {
      path: "/tmp/presets.json",
      schemaVersion: 1,
      appVersion: "0.2.1",
      exportedAtMs: 1730000000000,
      presetCount: 2,
    };
    invokeMock.mockResolvedValueOnce(result);

    const out = await exportPresetsBundle(" /tmp/presets.json ", ["p1", "p2"]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("export_presets_bundle", {
      targetPath: "/tmp/presets.json",
      target_path: "/tmp/presets.json",
      presetIds: ["p1", "p2"],
      preset_ids: ["p1", "p2"],
    });
    expect(out).toEqual(result);
  });

  it("readPresetsBundle calls read_presets_bundle with both camelCase and snake_case keys", async () => {
    const bundle: PresetBundle = {
      schemaVersion: 1,
      appVersion: "0.2.1",
      exportedAtMs: 1730000000000,
      presets: [],
    };
    invokeMock.mockResolvedValueOnce(bundle);

    const loaded = await readPresetsBundle(" /tmp/in.json ");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("read_presets_bundle", {
      sourcePath: "/tmp/in.json",
      source_path: "/tmp/in.json",
    });
    expect(loaded).toEqual(bundle);
  });
});
