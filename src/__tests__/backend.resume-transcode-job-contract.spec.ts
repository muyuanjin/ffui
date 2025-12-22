import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { resumeTranscodeJob } from "@/lib/backend";

describe("backend resume transcode job contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("resumeTranscodeJob calls resume_transcode_job with stable keys", async () => {
    await resumeTranscodeJob("job-1");
    expect(invokeMock).toHaveBeenCalledWith("resume_transcode_job", {
      jobId: "job-1",
      job_id: "job-1",
    });
  });
});
