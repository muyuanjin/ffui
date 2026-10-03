import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadJobDetail } from "@/lib/backend/queue";
import fixture from "../../src-tauri/tests/job-detail-loading-contract.json";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("job detail loading IPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  it("preserves successful empty logs and distinguishes a missing job", async () => {
    invokeMock.mockResolvedValueOnce(fixture.job).mockResolvedValueOnce(null);
    expect(await loadJobDetail(fixture.payload.jobId)).toMatchObject(fixture.job);
    expect(invokeMock).toHaveBeenLastCalledWith(fixture.command, fixture.payload);
    expect(await loadJobDetail("missing")).toBeNull();
  });
  it("propagates the read failure instead of returning an empty success", async () => {
    invokeMock.mockRejectedValue(new Error("transport denied"));
    await expect(loadJobDetail(fixture.payload.jobId)).rejects.toThrow("transport denied");
    expect(invokeMock).toHaveBeenCalledWith(fixture.command, fixture.payload);
  });
});
