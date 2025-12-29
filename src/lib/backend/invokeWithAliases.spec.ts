import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
  };
});

import { assertCanonicalInvokePayload, invokeCommand } from "./invokeCommand";
import { invokeWithAliases } from "./invokeWithAliases";

describe("invokeCommand", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("forwards canonical camelCase payloads to invoke", async () => {
    invokeMock.mockResolvedValueOnce(true);

    await invokeCommand("cancel_transcode_job", { jobId: "job-1" });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("cancel_transcode_job");
    expect(payload).toEqual({ jobId: "job-1" });
  });

  it("rejects snake_case payload keys", async () => {
    expect(() => assertCanonicalInvokePayload({ job_id: "job-1" })).toThrow(/snake_case/i);

    await expect(invokeCommand("cancel_transcode_job", { job_id: "job-1" } as any)).rejects.toThrow(/snake_case/i);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps invokeWithAliases as a compatibility alias that enforces canonical keys", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await invokeWithAliases("cancel_transcode_job", { jobId: "job-1" });
    expect(invokeMock).toHaveBeenCalledWith("cancel_transcode_job", { jobId: "job-1" });
  });
});
