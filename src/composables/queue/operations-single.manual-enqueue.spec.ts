import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import type { SingleJobOpsDeps } from "./operations-single";

const makePreset = (): FFmpegPreset => ({
  id: "preset-1",
  name: "Default",
  description: "test preset",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
});

interface Harness {
  enqueueManualJobsFromPaths: typeof import("./operations-single").enqueueManualJobsFromPaths;
  jobMock: ReturnType<typeof vi.fn>;
  jobsMock: ReturnType<typeof vi.fn>;
  expandMock: ReturnType<typeof vi.fn>;
  deps: SingleJobOpsDeps;
}

async function withManualEnqueueMock<T>(fn: (harness: Harness) => Promise<T>): Promise<T> {
  await vi.resetModules();

  const jobMock = vi.fn(async (_request?: unknown) => ({}) as unknown as TranscodeJob);
  const jobsMock = vi.fn(async (_request?: unknown) => [] as TranscodeJob[]);
  const expandMock = vi.fn(async (paths: string[]) => ({ accepted: paths, skipped: 0 }));
  vi.doMock("@/lib/backend", () => ({
    hasTauri: () => true,
    enqueueTranscodeJob: (request: unknown) => jobMock(request),
    enqueueTranscodeJobs: (request: unknown) => jobsMock(request),
    expandManualJobInputs: (paths: string[]) => expandMock(paths),
  }));

  const { enqueueManualJobsFromPaths } = await import("./operations-single");
  const deps = {
    presets: computed<FFmpegPreset[]>(() => [makePreset()]),
    manualJobPreset: computed<FFmpegPreset | null>(() => null),
    queueError: ref<string | null>(null),
    refreshQueueFromBackend: vi.fn(async () => {}),
    t: (key: string) => key,
  } as unknown as SingleJobOpsDeps;
  try {
    return await fn({ enqueueManualJobsFromPaths, jobMock, jobsMock, expandMock, deps });
  } finally {
    vi.doUnmock("@/lib/backend");
    await vi.resetModules();
  }
}

const queueErrorValue = (deps: SingleJobOpsDeps) =>
  (deps as unknown as { queueError: { value: string | null } }).queueError.value;

describe("enqueueManualJobsFromPaths", () => {
  it("enqueues video files and reports that audio and image inputs were skipped", async () => {
    await withManualEnqueueMock(async ({ enqueueManualJobsFromPaths, jobMock, expandMock, deps }) => {
      expandMock.mockResolvedValueOnce({ accepted: ["C:/v/a.mp4"], skipped: 1 });

      await enqueueManualJobsFromPaths(["C:/v/a.mp4", "C:/m/b.mp3"], deps);

      expect(jobMock).toHaveBeenCalledTimes(1);
      expect(jobMock).toHaveBeenCalledWith(expect.objectContaining({ filename: "C:/v/a.mp4", jobType: "video" }));
      expect(queueErrorValue(deps)).toBe("queue.error.unsupportedMedia");
    });
  });

  it("explains an audio-only selection without enqueueing anything", async () => {
    await withManualEnqueueMock(async ({ enqueueManualJobsFromPaths, jobMock, jobsMock, expandMock, deps }) => {
      expandMock.mockResolvedValueOnce({ accepted: [], skipped: 1 });

      await enqueueManualJobsFromPaths(["C:/m/b.flac"], deps);

      expect(jobMock).not.toHaveBeenCalled();
      expect(jobsMock).not.toHaveBeenCalled();
      expect(queueErrorValue(deps)).toBe("queue.error.unsupportedMedia");
    });
  });

  it("explains a music folder that contains no video (this used to be silence)", async () => {
    await withManualEnqueueMock(async ({ enqueueManualJobsFromPaths, jobMock, jobsMock, expandMock, deps }) => {
      expandMock.mockResolvedValueOnce({ accepted: [], skipped: 3 });

      await enqueueManualJobsFromPaths(["C:/Music/Album"], deps);

      expect(jobMock).not.toHaveBeenCalled();
      expect(jobsMock).not.toHaveBeenCalled();
      expect(queueErrorValue(deps)).toBe("queue.error.unsupportedMedia");
    });
  });

  it("stays quiet for a video-only selection", async () => {
    await withManualEnqueueMock(async ({ enqueueManualJobsFromPaths, jobMock, expandMock, deps }) => {
      expandMock.mockResolvedValueOnce({ accepted: ["C:/v/a.mp4"], skipped: 0 });

      await enqueueManualJobsFromPaths(["C:/v/a.mp4"], deps);

      expect(jobMock).toHaveBeenCalledTimes(1);
      expect(queueErrorValue(deps)).toBeNull();
    });
  });
});
