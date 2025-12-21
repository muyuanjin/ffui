import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload: Record<string, unknown>) => invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import { loadQueueStateLite } from "./backend";

describe("backend queue state contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loadQueueStateLite preserves waitMetadata field names and values", async () => {
    const fake = {
      jobs: [
        {
          id: "job-1",
          filename: "C:/videos/in.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          presetId: "preset-1",
          status: "paused",
          progress: 40,
          logs: [],
          waitMetadata: {
            processedWallMillis: 1234,
            processedSeconds: 36.223129,
            tmpOutputPath: "C:/tmp/seg0.mkv",
            segments: ["C:/tmp/seg0.mkv"],
          },
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueStateLite();

    expect(invokeMock).toHaveBeenCalledWith("get_queue_state_lite", undefined);
    expect(result.jobs[0]?.waitMetadata?.processedWallMillis).toBe(1234);
    expect(result.jobs[0]?.waitMetadata?.processedSeconds).toBeCloseTo(36.223129, 6);
    expect(result.jobs[0]?.waitMetadata?.tmpOutputPath).toBe("C:/tmp/seg0.mkv");
    expect(result.jobs[0]?.waitMetadata?.segments).toEqual(["C:/tmp/seg0.mkv"]);
  });
});
