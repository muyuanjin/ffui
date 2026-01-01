// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>(async () => ({ outcome: "ok" }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => (payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload)),
  convertFileSrc: (path: string) => path,
}));

import { validatePresetTemplate } from "@/lib/backend";

describe("backend preset template validation contract", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    (window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ ?? {};
  });

  it("invokes validate_preset_template with preset payload", async () => {
    await validatePresetTemplate({
      id: "p",
      name: "p",
      description: "",
      advancedEnabled: true,
      ffmpegTemplate: "ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT",
    } as any);

    expect(invokeMock).toHaveBeenCalledWith(
      "validate_preset_template",
      expect.objectContaining({
        preset: expect.any(Object),
      }),
    );
  });

  it("omits timeoutMs unless explicitly provided", async () => {
    const preset = {
      id: "p",
      name: "p",
      description: "",
      advancedEnabled: true,
      ffmpegTemplate: "ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT",
    } as any;

    await validatePresetTemplate(preset);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const firstPayload = invokeMock.mock.calls[0]?.[1] as any;
    expect(firstPayload).toEqual(expect.objectContaining({ preset }));
    expect(Object.prototype.hasOwnProperty.call(firstPayload, "timeoutMs")).toBe(false);

    invokeMock.mockClear();
    await validatePresetTemplate(preset, { timeoutMs: 1234 });
    expect(invokeMock).toHaveBeenCalledWith(
      "validate_preset_template",
      expect.objectContaining({
        preset,
        timeoutMs: 1234,
      }),
    );
  });
});
