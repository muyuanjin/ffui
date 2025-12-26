// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>(async () => null);

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import { getQueueStartupHint, resumeStartupQueue } from "@/lib/backend.queue-startup";

describe("backend queue startup contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as any).__TAURI_INTERNALS__ = {};
  });

  it("getQueueStartupHint invokes get_queue_startup_hint without payload", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "crashOrKill", autoPausedJobCount: 2 });
    const result = await getQueueStartupHint();
    expect(invokeMock).toHaveBeenCalledWith("get_queue_startup_hint", undefined);
    expect(result).toEqual({ kind: "crashOrKill", autoPausedJobCount: 2 });
  });

  it("resumeStartupQueue invokes resume_startup_queue without payload", async () => {
    invokeMock.mockResolvedValueOnce(3);
    const result = await resumeStartupQueue();
    expect(invokeMock).toHaveBeenCalledWith("resume_startup_queue", undefined);
    expect(result).toBe(3);
  });
});
