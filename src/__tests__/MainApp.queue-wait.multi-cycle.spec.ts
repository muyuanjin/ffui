// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import {
  emitQueueState,
  getQueueJobs,
  i18n,
  invokeMock,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import MainApp from "@/MainApp.vue";

function getJobsFromVm(vm: any): TranscodeJob[] {
  const ref = vm.jobs;
  if (Array.isArray(ref)) return ref;
  if (ref && Array.isArray(ref.value)) return ref.value;
  return [];
}

async function flushQueuedQueueStateApply() {
  await nextTick();
  await new Promise((r) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => r(null));
    } else {
      setTimeout(r, 0);
    }
  });
  await nextTick();
}

describe("MainApp repeated wait/resume cycles", () => {
  it("handles multiple wait/resume cycles and keeps waitMetadata from backend snapshots", async () => {
    const jobId = "job-multi-wait-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/multi-wait.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 25,
        logs: [],
      } as TranscodeJob,
    ]);

    const calls: string[] = [];
    useBackendMock({
      wait_transcode_job: (payload) => {
        calls.push("wait");
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
      resume_transcode_job: (payload) => {
        calls.push("resume");
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        const current = getQueueJobs();
        setQueueJobs(current.map((job) => (job.id === jobId ? { ...job, status: "waiting" } : job)));
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    await vm.handleWaitJob(jobId);
    await nextTick();

    emitQueueState([
      {
        id: jobId,
        filename: "C:/videos/multi-wait.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
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
      } as TranscodeJob,
    ]);
    await flushQueuedQueueStateApply();

    const pausedJob0 = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(pausedJob0?.status).toBe("paused");
    expect(pausedJob0?.waitMetadata?.processedWallMillis).toBe(1234);
    expect(pausedJob0?.waitMetadata?.processedSeconds).toBeCloseTo(36.223129, 6);

    await vm.handleResumeJob(jobId);
    await nextTick();

    emitQueueState([
      {
        id: jobId,
        filename: "C:/videos/multi-wait.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 50,
        logs: [],
        waitMetadata: {
          processedWallMillis: 1234,
          processedSeconds: 36.223129,
          tmpOutputPath: "C:/tmp/seg0.mkv",
          segments: ["C:/tmp/seg0.mkv"],
        },
      } as TranscodeJob,
    ]);
    await flushQueuedQueueStateApply();

    await vm.handleWaitJob(jobId);
    await nextTick();

    emitQueueState([
      {
        id: jobId,
        filename: "C:/videos/multi-wait.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "paused",
        progress: 80,
        logs: [],
        waitMetadata: {
          processedWallMillis: 2468,
          processedSeconds: 73.873,
          tmpOutputPath: "C:/tmp/seg1.mkv",
          segments: ["C:/tmp/seg0.mkv", "C:/tmp/seg1.mkv"],
        },
      } as TranscodeJob,
    ]);
    await flushQueuedQueueStateApply();

    const pausedJob1 = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(pausedJob1?.status).toBe("paused");
    expect(pausedJob1?.waitMetadata?.processedWallMillis).toBe(2468);
    expect(pausedJob1?.waitMetadata?.processedSeconds).toBeCloseTo(73.873, 3);
    expect(pausedJob1?.waitMetadata?.segments).toEqual(["C:/tmp/seg0.mkv", "C:/tmp/seg1.mkv"]);

    await vm.handleResumeJob(jobId);
    await nextTick();

    expect(calls).toEqual(["wait", "resume", "wait", "resume"]);
    expect(invokeMock).toHaveBeenCalledWith("wait_transcode_job", expect.objectContaining({ jobId }));
    expect(invokeMock).toHaveBeenCalledWith("resume_transcode_job", expect.objectContaining({ jobId }));

    wrapper.unmount();
  });
});
