// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { measureJobVmaf } from "@/lib/backend";

describe("backend measure job VMAF contract", () => {
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    invokeMock.mockReset();
  });

  it("calls measure_job_vmaf with stable keys", async () => {
    await measureJobVmaf("job-1", { trimSeconds: 10 });
    expect(invokeMock).toHaveBeenCalledWith("measure_job_vmaf", {
      jobId: "job-1",
      trimSeconds: 10,
    });
  });

  it("normalizes trimSeconds to null when invalid", async () => {
    await measureJobVmaf("job-1", { trimSeconds: 0 });
    expect(invokeMock).toHaveBeenCalledWith("measure_job_vmaf", {
      jobId: "job-1",
      trimSeconds: null,
    });
  });
});
