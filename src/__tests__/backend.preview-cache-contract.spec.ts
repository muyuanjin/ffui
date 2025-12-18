import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { cleanupFallbackPreviewFramesAsync, cleanupPreviewCachesAsync } from "@/lib/backend";

describe("backend preview cache contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("cleanupFallbackPreviewFramesAsync calls cleanup_fallback_preview_frames_async", async () => {
    invokeMock.mockResolvedValueOnce(true);

    const ok = await cleanupFallbackPreviewFramesAsync();
    expect(ok).toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("cleanup_fallback_preview_frames_async", {});
  });

  it("cleanupPreviewCachesAsync calls cleanup_preview_caches_async", async () => {
    invokeMock.mockResolvedValueOnce(true);

    const ok = await cleanupPreviewCachesAsync();
    expect(ok).toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("cleanup_preview_caches_async", {});
  });
});
