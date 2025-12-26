import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscodeJob } from "../types";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload: Record<string, unknown>) => invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import {
  enqueueTranscodeJob,
  enqueueTranscodeJobs,
  cancelTranscodeJob,
  waitTranscodeJob,
  waitTranscodeJobsBulk,
  resumeTranscodeJob,
  restartTranscodeJob,
  deleteTranscodeJob,
  deleteBatchCompressBatchOnBackend,
  reorderQueue,
  loadPreviewDataUrl,
  ensureJobPreview,
  inspectMedia,
  selectPlayableMediaPath,
  revealPathInFolder,
  loadQueueState,
  loadQueueStateLite,
  getJobCompareSources,
  extractJobCompareFrame,
  extractJobCompareConcatFrame,
} from "./backend";

describe("backend contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends both camelCase and snake_case keys expected by the Rust command", async () => {
    const fakeJob: TranscodeJob = {
      id: "1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 0,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand: 'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
      mediaInfo: {
        durationSeconds: 120.5,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: "h264",
        sizeMB: 700,
      },
      previewPath: "C:/app-data/previews/abc123.jpg",
      logTail: "ffmpeg exited with non-zero status (exit code 1)",
      failureReason: "ffmpeg exited with non-zero status (exit code 1)",
    };

    invokeMock.mockResolvedValueOnce(fakeJob);

    const result = await enqueueTranscodeJob({
      filename: fakeJob.filename,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0,
      originalCodec: fakeJob.originalCodec,
      presetId: fakeJob.presetId,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("enqueue_transcode_job");

    // Core identifiers
    expect(payload).toMatchObject({
      filename: fakeJob.filename,
      jobType: "video",
      job_type: "video",
      originalSizeMb: 0,
      original_size_mb: 0,
      originalCodec: fakeJob.originalCodec,
      original_codec: fakeJob.originalCodec,
      presetId: fakeJob.presetId,
      preset_id: fakeJob.presetId,
    });

    // Ensure the returned job is passed through unchanged.
    expect(result).toEqual(fakeJob);
  });

  it("enqueueTranscodeJobs sends both camelCase and snake_case keys and preserves filename order", async () => {
    const filenames = ["C:/videos/02.mp4", "C:/videos/03.mkv"];
    const presetId = "preset-1";
    const fakeJobs: TranscodeJob[] = filenames.map((filename, idx) => ({
      id: `job-${idx + 1}`,
      filename,
      type: "video",
      source: "manual",
      originalSizeMB: 0,
      originalCodec: "h264",
      presetId,
      status: "queued",
      progress: 0,
      logs: [],
    }));

    invokeMock.mockResolvedValueOnce(fakeJobs);

    const result = await enqueueTranscodeJobs({
      filenames,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0,
      originalCodec: "h264",
      presetId,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("enqueue_transcode_jobs");
    expect(payload).toMatchObject({
      filenames,
      fileNames: filenames,
      jobType: "video",
      job_type: "video",
      originalSizeMb: 0,
      original_size_mb: 0,
      originalCodec: "h264",
      original_codec: "h264",
      presetId,
      preset_id: presetId,
      source: "manual",
    });

    expect(result).toEqual(fakeJobs);
  });

  it("getJobCompareSources sends args wrapper with camelCase keys", async () => {
    invokeMock.mockResolvedValueOnce(null);

    const result = await getJobCompareSources("job-1");

    expect(result).toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("get_job_compare_sources");
    expect(payload).toMatchObject({
      args: {
        jobId: "job-1",
      },
    });
  });

  it("extractJobCompareFrame uses extract_job_compare_frame with args wrapper", async () => {
    const previewPath = "C:/app-data/previews/compare-input.jpg";
    invokeMock.mockResolvedValueOnce(previewPath);

    const result = await extractJobCompareFrame({
      jobId: "job-1",
      sourcePath: "C:/videos/input.mp4",
      positionSeconds: 12.34,
      durationSeconds: 120,
      quality: "high",
    });

    expect(result).toBe(previewPath);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("extract_job_compare_frame");
    expect(payload).toMatchObject({
      args: {
        jobId: "job-1",
        sourcePath: "C:/videos/input.mp4",
        positionSeconds: 12.34,
        durationSeconds: 120,
        quality: "high",
      },
    });
  });

  it("extractJobCompareConcatFrame uses extract_job_compare_concat_frame with args wrapper", async () => {
    const previewPath = "C:/app-data/previews/compare-output.jpg";
    invokeMock.mockResolvedValueOnce(previewPath);

    const result = await extractJobCompareConcatFrame({
      jobId: "job-1",
      segmentPaths: ["C:/tmp/seg0.mp4", "C:/tmp/seg1.mp4"],
      positionSeconds: 9.87,
      quality: "low",
    });

    expect(result).toBe(previewPath);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("extract_job_compare_concat_frame");
    expect(payload).toMatchObject({
      args: {
        jobId: "job-1",
        segmentPaths: ["C:/tmp/seg0.mp4", "C:/tmp/seg1.mp4"],
        positionSeconds: 9.87,
        quality: "low",
      },
    });
  });

  it("loadPreviewDataUrl uses the dedicated preview command with both name variants", async () => {
    const previewPath = "C:/app-data/previews/abc123.jpg";
    const fakeUrl = "data:image/jpeg;base64,AAAA";

    invokeMock.mockResolvedValueOnce(fakeUrl);

    const result = await loadPreviewDataUrl(previewPath);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("get_preview_data_url");
    expect(payload).toMatchObject({
      previewPath,
      preview_path: previewPath,
    });

    expect(result).toBe(fakeUrl);
  });

  it("selectPlayableMediaPath delegates to select_playable_media_path with both name variants", async () => {
    const candidates = ["C:/videos/missing.compressed.mp4", "C:/videos/source.mp4"];
    const chosen = candidates[1];

    // Simulate a Tauri-like environment so selectPlayableMediaPath goes
    // through the invoke() branch instead of short-circuiting in web mode.
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.__TAURI__ = {};

    invokeMock.mockResolvedValueOnce(chosen);

    const result = await selectPlayableMediaPath(candidates);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("select_playable_media_path");
    expect(payload).toMatchObject({
      candidatePaths: candidates,
      candidate_paths: candidates,
    });

    expect(result).toBe(chosen);
  });

  it("selectPlayableMediaPath falls back to the first candidate when backend returns null", async () => {
    const candidates = ["C:/videos/output.mp4", "C:/videos/source.mp4"];

    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = { ...(originalWindow ?? {}), __TAURI__: {} };

    invokeMock.mockResolvedValueOnce(null);

    const result = await selectPlayableMediaPath(candidates);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(candidates[0]);

    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it("ensureJobPreview delegates to ensure_job_preview with both name variants", async () => {
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = { ...(originalWindow ?? {}), __TAURI__: {} };

    const jobId = "job-1";
    const previewPath = "C:/app-data/previews/regenerated.jpg";

    invokeMock.mockResolvedValueOnce(previewPath);

    const result = await ensureJobPreview(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("ensure_job_preview");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(previewPath);

    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it("loadQueueState calls get_queue_state without args", async () => {
    const fake = { jobs: [] };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueState();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("get_queue_state");
    expect(payload).toBeUndefined();
    expect(result).toEqual(fake);
  });

  it("loadQueueStateLite calls get_queue_state_lite without args", async () => {
    const fake = { jobs: [] };
    invokeMock.mockResolvedValueOnce(fake);

    const result = await loadQueueStateLite();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("get_queue_state_lite");
    expect(payload).toBeUndefined();
    expect(result).toEqual(fake);
  });

  it("revealPathInFolder calls reveal_path_in_folder with trimmed path", async () => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.__TAURI__ = {};

    await revealPathInFolder("  C:/videos/output.mp4  ");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("reveal_path_in_folder", {
      path: "C:/videos/output.mp4",
    });
  });

  it("revealPathInFolder no-ops when path is empty", async () => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.__TAURI__ = {};

    await revealPathInFolder("   ");

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("cancelTranscodeJob sends cancel_transcode_job with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);

    const jobId = "42";
    const result = await cancelTranscodeJob(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("cancel_transcode_job");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(true);
  });

  it("waitTranscodeJob sends wait_transcode_job with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const jobId = "job-wait";

    const result = await waitTranscodeJob(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("wait_transcode_job");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(true);
  });

  it("waitTranscodeJobsBulk sends wait_transcode_jobs_bulk with both ids name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const jobIds = ["job-1", "job-2", "job-3"];

    const result = await waitTranscodeJobsBulk(jobIds);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("wait_transcode_jobs_bulk");
    expect(payload).toMatchObject({
      jobIds,
      job_ids: jobIds,
    });
    expect(result).toBe(true);
  });

  it("resumeTranscodeJob sends resume_transcode_job with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const jobId = "job-resume";

    const result = await resumeTranscodeJob(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("resume_transcode_job");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(true);
  });

  it("restartTranscodeJob sends restart_transcode_job with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const jobId = "job-restart";

    const result = await restartTranscodeJob(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("restart_transcode_job");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(true);
  });

  it("deleteTranscodeJob sends delete_transcode_job with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const jobId = "job-delete";

    const result = await deleteTranscodeJob(jobId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("delete_transcode_job");
    expect(payload).toMatchObject({
      jobId,
      job_id: jobId,
    });
    expect(result).toBe(true);
  });

  it("deleteBatchCompressBatchOnBackend sends delete_batch_compress_batch with both id name variants", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const batchId = "batch-123";

    const result = await deleteBatchCompressBatchOnBackend(batchId);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("delete_batch_compress_batch");
    expect(payload).toMatchObject({
      batchId,
      batch_id: batchId,
    });
    expect(result).toBe(true);
  });

  it("reorderQueue sends reorder_queue with orderedIds and ordered_ids payload", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const ids = ["a", "b", "c"];

    const result = await reorderQueue(ids);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("reorder_queue");
    expect(payload).toMatchObject({
      orderedIds: ids,
      ordered_ids: ids,
      jobIds: ids,
      job_ids: ids,
    });
    expect(result).toBe(true);
  });

  it("inspectMedia sends inspect_media with the path payload and returns raw ffprobe JSON", async () => {
    const path = "C:/videos/sample.mp4";
    const fakeJson = '{"format":{"duration":"120.5"},"streams":[]}';

    invokeMock.mockResolvedValueOnce(fakeJson);

    const result = await inspectMedia(path);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("inspect_media");
    expect(payload).toMatchObject({ path });
    expect(result).toBe(fakeJson);
  });
});
