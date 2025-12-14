// @vitest-environment jsdom
import {
  i18n,
  invokeMock,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";

function getJobsFromVm(vm: any): TranscodeJob[] {
  const ref = vm.jobs;
  if (Array.isArray(ref)) return ref;
  if (ref && Array.isArray(ref.value)) return ref.value;
  return [];
}

describe("MainApp queue wait/resume/restart in Tauri mode", () => {
  it("sends wait_transcode_job and keeps the job processing while showing a UI log entry", async () => {
    const jobId = "job-wait-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/wait-me.mp4",
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

    useBackendMock({
      wait_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();
    expect(getJobsFromVm(vm).length).toBeGreaterThan(0);

    await vm.handleWaitJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("processing");
    expect(updatedJob?.logs?.join("\n") ?? "").toContain("Wait requested from UI");
    expect(invokeMock).toHaveBeenCalledWith("wait_transcode_job", expect.any(Object));
  });

  it("sends resume_transcode_job and moves a paused job back to waiting", async () => {
    const jobId = "job-resume-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/resume-me.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "paused",
        progress: 30,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({
      resume_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    await vm.handleResumeJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("waiting");
  });

  it("cancels a paused job immediately when backend accepts cancel_transcode_job", async () => {
    const jobId = "job-cancel-paused-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/cancel-paused.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "paused",
        progress: 30,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({
      cancel_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    await vm.handleCancelJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("cancelled");
    expect(invokeMock).toHaveBeenCalledWith("cancel_transcode_job", expect.any(Object));
  });

  it("sends restart_transcode_job and clears progress for non-terminal jobs", async () => {
    const jobId = "job-restart-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/restart.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "failed",
        progress: 80,
        logs: ["failed: gpu reset"],
      } as TranscodeJob,
    ]);

    useBackendMock({
      restart_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    await vm.handleRestartJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("waiting");
    expect(updatedJob?.progress).toBe(0);
  });

  it("allows restart_transcode_job for cancelled jobs and requeues them from 0 percent", async () => {
    const jobId = "job-restart-cancelled-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/restart-cancelled.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "cancelled",
        progress: 45,
        logs: ["cancelled by user"],
      } as TranscodeJob,
    ]);

    useBackendMock({
      restart_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    await vm.handleRestartJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("waiting");
    expect(updatedJob?.progress).toBe(0);
  });

  it("wires queue context menu wait action through to wait_transcode_job and keeps job processing until backend pause completes", async () => {
    const jobId = "job-context-wait-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/context-wait.mp4",
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

    useBackendMock({
      wait_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    const jobs = getJobsFromVm(vm);
    expect(jobs.length).toBe(1);

    // Open context menu for the processing job and invoke the wait handler.
    vm.openQueueContextMenuForJob({
      job: jobs[0],
      event: { clientX: 0, clientY: 0 } as any,
    });
    await vm.handleQueueContextWait();
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("processing");
    expect(updatedJob?.logs?.join("\n") ?? "").toContain("Wait requested from UI");
    expect(invokeMock).toHaveBeenCalledWith(
      "wait_transcode_job",
      expect.objectContaining({ jobId }),
    );
  });

  it("wires queue context menu resume action through to resume_transcode_job and updates job status", async () => {
    const jobId = "job-context-resume-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/context-resume.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "paused",
        progress: 60,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({
      resume_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    const jobs = getJobsFromVm(vm);
    expect(jobs.length).toBe(1);

    vm.openQueueContextMenuForJob({
      job: jobs[0],
      event: { clientX: 0, clientY: 0 } as any,
    });
    await vm.handleQueueContextResume();
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("waiting");
    expect(invokeMock).toHaveBeenCalledWith(
      "resume_transcode_job",
      expect.objectContaining({ jobId }),
    );
  });

  it("opens input and output folders from the queue context menu", async () => {
    const jobId = "job-context-reveal";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/context-reveal.mp4",
        inputPath: "C:/videos/context-reveal.mp4",
        outputPath: "C:/videos/context-reveal-output.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "completed",
        progress: 100,
        logs: [],
      } as TranscodeJob,
    ]);

    useBackendMock({
      reveal_path_in_folder: (payload) => {
        expect(payload?.path).toBeDefined();
        return null;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    const job = getJobsFromVm(vm)[0];
    vm.openQueueContextMenuForJob({
      job,
      event: { clientX: 0, clientY: 0 } as any,
    });

    await vm.handleQueueContextOpenInputFolder();
    await vm.handleQueueContextOpenOutputFolder();

    expect(invokeMock).toHaveBeenCalledWith("reveal_path_in_folder", {
      path: job.inputPath,
    });
    expect(invokeMock).toHaveBeenCalledWith("reveal_path_in_folder", {
      path: job.outputPath,
    });
  });

});
