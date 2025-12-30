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

  it("loadQueueStateLite preserves queueOrder field values", async () => {
    const fake = {
      jobs: [
        {
          id: "job-queue-1",
          filename: "C:/videos/in-1.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          presetId: "preset-1",
          status: "queued",
          queueOrder: 3,
          progress: 0,
          logs: [],
        },
        {
          id: "job-queue-2",
          filename: "C:/videos/in-2.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          presetId: "preset-1",
          status: "processing",
          waitRequestPending: true,
          queueOrder: null,
          progress: 10,
          logs: [],
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueStateLite();

    expect(result.jobs[0]?.status).toBe("queued");
    expect(result.jobs[0]?.queueOrder).toBe(3);
    expect(result.jobs[1]?.queueOrder).toBeNull();
    expect(result.jobs[1]?.waitRequestPending).toBe(true);
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
            targetSeconds: 36.223129,
            lastProgressOutTimeSeconds: 36.223129,
            lastProgressSpeed: 1.75,
            lastProgressUpdatedAtMs: 1712345678901,
            progressEpoch: 3,
            lastProgressFrame: 12345,
            tmpOutputPath: "C:/tmp/seg0.mkv",
          },
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueStateLite();

    expect(invokeMock).toHaveBeenCalledWith("get_queue_state_lite", undefined);
    expect(result.jobs[0]?.waitMetadata?.processedWallMillis).toBe(1234);
    expect(result.jobs[0]?.waitMetadata?.processedSeconds).toBeCloseTo(36.223129, 6);
    expect(result.jobs[0]?.waitMetadata?.targetSeconds).toBeCloseTo(36.223129, 6);
    expect(result.jobs[0]?.waitMetadata?.lastProgressOutTimeSeconds).toBeCloseTo(36.223129, 6);
    expect(result.jobs[0]?.waitMetadata?.lastProgressSpeed).toBeCloseTo(1.75, 6);
    expect(result.jobs[0]?.waitMetadata?.lastProgressUpdatedAtMs).toBe(1712345678901);
    expect(result.jobs[0]?.waitMetadata?.progressEpoch).toBe(3);
    expect(result.jobs[0]?.waitMetadata?.lastProgressFrame).toBe(12345);
    expect(result.jobs[0]?.waitMetadata?.tmpOutputPath).toBe("C:/tmp/seg0.mkv");
    expect(result.jobs[0]?.waitMetadata?.segments).toBeUndefined();
    expect(result.jobs[0]?.waitMetadata?.segmentEndTargets).toBeUndefined();
  });

  it("loadQueueStateLite does not synthesize crash-recovery segment arrays", async () => {
    const fake = {
      jobs: [
        {
          id: "job-2",
          filename: "C:/videos/in.mp4",
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          presetId: "preset-1",
          status: "paused",
          progress: 40,
          logs: [],
          waitMetadata: {
            processedWallMillis: 2468,
            processedSeconds: 73.873,
            targetSeconds: 73.873,
            tmpOutputPath: "C:/tmp/seg1.mkv",
          },
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueStateLite();

    expect(result.jobs[0]?.waitMetadata?.tmpOutputPath).toBe("C:/tmp/seg1.mkv");
    expect(result.jobs[0]?.waitMetadata?.segments).toBeUndefined();
    expect(result.jobs[0]?.waitMetadata?.segmentEndTargets).toBeUndefined();
  });
});
