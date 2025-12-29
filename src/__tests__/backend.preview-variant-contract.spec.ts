// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { ensureJobPreviewVariant } from "@/lib/backend";

describe("backend preview variant contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ ?? {};
  });

  it("ensureJobPreviewVariant calls ensure_job_preview_variant with stable keys", async () => {
    invokeMock.mockResolvedValueOnce("C:/previews/thumb-cache/x.jpg");

    const path = await ensureJobPreviewVariant("job-1", 720);
    expect(path).toBe("C:/previews/thumb-cache/x.jpg");

    const [cmd, payload] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("ensure_job_preview_variant");
    expect(payload).toMatchObject({
      jobId: "job-1",
      heightPx: 720,
    });
  });
});
