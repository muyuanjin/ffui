import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
  };
});

import { addSnakeCaseAliases, invokeWithAliases } from "./invokeWithAliases";

describe("invokeWithAliases", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("addSnakeCaseAliases adds snake_case keys without overwriting", () => {
    expect(
      addSnakeCaseAliases({
        jobId: "job-1",
        job_id: "existing",
        remoteCheck: true,
      }),
    ).toEqual({
      jobId: "job-1",
      job_id: "existing",
      remoteCheck: true,
      remote_check: true,
    });
  });

  it("invokeWithAliases forwards both key variants to invoke", async () => {
    invokeMock.mockResolvedValueOnce(true);

    await invokeWithAliases("cancel_transcode_job", { jobId: "job-1" });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("cancel_transcode_job");
    expect(payload).toEqual({ jobId: "job-1", job_id: "job-1" });
  });
});
