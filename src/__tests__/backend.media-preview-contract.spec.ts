import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import fixture from "../../src-tauri/tests/media-preview-contract.json";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import { prepareNativeMediaPreview, probeMediaPreviewInfo } from "@/lib/backend/mediaPreview";

describe("media preview IPC", () => {
  beforeEach(() => invokeMock.mockReset());
  it("round-trips the backend descriptor and exact Windows Unicode source", async () => {
    for (const info of fixture.info) {
      invokeMock.mockResolvedValueOnce(info);
      expect(await probeMediaPreviewInfo(fixture.probe.payload.sourcePath)).toEqual(info);
      expect(invokeMock).toHaveBeenLastCalledWith(fixture.probe.command, fixture.probe.payload);
    }
    invokeMock.mockResolvedValueOnce("C:\\cache\\preview.m4a");
    expect(await prepareNativeMediaPreview(fixture.prepare.payload.sourcePath, "audio")).toBe("C:\\cache\\preview.m4a");
    expect(invokeMock).toHaveBeenLastCalledWith(fixture.prepare.command, fixture.prepare.payload);
  });
  it.each([null, { kind: "other", durationSeconds: null }, { kind: "audio", durationSeconds: -1 }, { kind: "audio" }])(
    "rejects invalid probe descriptors: %j",
    async (info) => {
      invokeMock.mockResolvedValueOnce(info);
      await expect(probeMediaPreviewInfo("source")).rejects.toThrow("Invalid media preview probe response");
    },
  );
  it("registers both commands in the Tauri handler", () => {
    const handlers = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(handlers).toContain("commands::tools::media_preview::probe_media_preview_info");
    expect(handlers).toContain("commands::tools::media_preview::prepare_native_media_preview");
  });
});
