import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadQueueStateLite } from "@/lib/backend";
import contract from "../../src-tauri/tests/manual-recovery-capability-contract.json";
import { createQueueContextMenuPermissions } from "@/components/main/queueContextMenu.permissions";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("legacy queue recovery capability boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  it("retains invalid execution capability and its diagnostic in the lightweight queue", async () => {
    invokeMock.mockResolvedValueOnce({
      snapshotRevision: 1,
      latestDeltaRevision: 0,
      jobs: [
        {
          id: "legacy",
          filename: "legacy.mp4",
          type: "video",
          source: "manual",
          presetId: "preset-1",
          status: "paused",
          progress: 0,
          originalSizeMB: 0,
          executionMode: contract.executionMode,
          failureReason: contract.invalidExecution.reason,
        },
      ],
    });
    const state = await loadQueueStateLite();
    expect(state.jobs[0]?.executionMode).toBe("invalid");
    expect(state.jobs[0]?.failureReason).toBe(contract.invalidExecution.reason);
    expect(state.jobs[0]?.progress).toBe(0);
    const job = state.jobs[0]!;
    const permissions = createQueueContextMenuPermissions({
      mode: "single",
      queueMode: "queue",
      hasSelection: false,
      jobStatus: job.status,
      jobExecutionMode: job.executionMode,
    });
    expect(permissions.canResume.value).toBe(false);
    expect(permissions.canWait.value).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("get_queue_state_lite");
  });
});
