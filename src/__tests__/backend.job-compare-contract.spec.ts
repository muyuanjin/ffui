import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { extractJobCompareOutputFrame } from "@/lib/backend";

describe("backend job compare contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("extractJobCompareOutputFrame calls extract_job_compare_output_frame with stable args", async () => {
    invokeMock.mockResolvedValueOnce("C:/previews/out.jpg");

    await extractJobCompareOutputFrame({
      jobId: "job-1",
      positionSeconds: 12.5,
      durationSeconds: 120,
      quality: "high",
    });

    const [cmd, payload] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("extract_job_compare_output_frame");
    expect(payload).toMatchObject({
      args: {
        jobId: "job-1",
        positionSeconds: 12.5,
        durationSeconds: 120,
        quality: "high",
      },
    });
  });
});
