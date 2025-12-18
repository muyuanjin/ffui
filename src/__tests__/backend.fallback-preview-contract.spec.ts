import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { extractFallbackPreviewFrame } from "@/lib/backend";

describe("backend fallback preview contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("extractFallbackPreviewFrame calls extract_fallback_preview_frame with stable keys", async () => {
    invokeMock.mockResolvedValueOnce("/tmp/frame.jpg");

    await extractFallbackPreviewFrame({
      sourcePath: "C:/videos/sample.mp4",
      positionPercent: 80,
      durationSeconds: 12,
      quality: "low",
    });

    const [cmd, payload] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("extract_fallback_preview_frame");
    expect(payload).toMatchObject({
      sourcePath: "C:/videos/sample.mp4",
      source_path: "C:/videos/sample.mp4",
      positionPercent: 80,
      position_percent: 80,
      durationSeconds: 12,
      duration_seconds: 12,
      quality: "low",
    });
  });
});
