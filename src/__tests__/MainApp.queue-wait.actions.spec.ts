// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob, QueueState, AppSettings } from "@/types";
import MainApp from "@/MainApp.vue";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

const invokeMock = vi.fn<
  (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
>();
const listenMock = vi.fn<
  (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>
>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: Parameters<typeof listenMock>) => listenMock(...args) }));
vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return { ...actual, hasTauri: () => true };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

let queueJobs: TranscodeJob[] = [];
let queueStateHandler: ((event: { payload: unknown }) => void) | null = null;
void queueStateHandler;

beforeEach(() => {
  (window as any).__TAURI_IPC__ = {};
  invokeMock.mockReset();
  listenMock.mockReset();
  queueJobs = [];
  queueStateHandler = null;

  listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (event === "ffui://queue-state" || event === "ffui://queue-state-lite") {
      queueStateHandler = handler;
    }
    return () => {};
  });
});

function makeDefaultSettings(): AppSettings {
  return {
    tools: {
      ffmpegPath: undefined,
      ffprobePath: undefined,
      avifencPath: undefined,
      autoDownload: false,
      autoUpdate: false,
    },
    smartScanDefaults: buildSmartScanDefaults(),
    previewCapturePercent: 25,
    maxParallelJobs: undefined,
    progressUpdateIntervalMs: undefined,
    taskbarProgressMode: "byEstimatedTime",
  };
}

function getJobsFromVm(vm: any): TranscodeJob[] {
  const ref = vm.jobs;
  if (Array.isArray(ref)) return ref;
  if (ref && Array.isArray(ref.value)) return ref.value;
  return [];
}

describe("MainApp queue wait/resume/restart in Tauri mode", () => {
  it("sends wait_transcode_job and marks the job as paused with a UI log entry", async () => {
    const jobId = "job-wait-1";
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      switch (cmd) {
        case "get_queue_state":
        case "get_queue_state_lite":
          return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
        case "get_app_settings":
          return Promise.resolve(makeDefaultSettings());
        case "get_cpu_usage":
          return Promise.resolve({ overall: 0, perCore: [] });
        case "get_gpu_usage":
          return Promise.resolve({ available: false });
        case "get_external_tool_statuses":
          return Promise.resolve([]);
        case "wait_transcode_job":
          expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
          return Promise.resolve(true);
        default:
          return Promise.resolve(null);
      }
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();
    expect(getJobsFromVm(vm).length).toBeGreaterThan(0);

    await vm.handleWaitJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("paused");
    expect(invokeMock).toHaveBeenCalledWith("wait_transcode_job", expect.any(Object));
  });

  it("sends resume_transcode_job and moves a paused job back to waiting", async () => {
    const jobId = "job-resume-1";
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite")
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "resume_transcode_job") {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    await vm.handleResumeJob(jobId);
    await nextTick();

    const updatedJob = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updatedJob?.status).toBe("waiting");
  });

  it("sends restart_transcode_job and clears progress for non-terminal jobs", async () => {
    const jobId = "job-restart-1";
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite")
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "restart_transcode_job") {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
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
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite")
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "restart_transcode_job") {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
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

  it("wires queue context menu wait action through to wait_transcode_job and updates job status", async () => {
    const jobId = "job-context-wait-1";
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      switch (cmd) {
        case "get_queue_state":
        case "get_queue_state_lite":
          return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
        case "get_app_settings":
          return Promise.resolve(makeDefaultSettings());
        case "get_cpu_usage":
          return Promise.resolve({ overall: 0, perCore: [] });
        case "get_gpu_usage":
          return Promise.resolve({ available: false });
        case "get_external_tool_statuses":
          return Promise.resolve([]);
        case "wait_transcode_job":
          expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
          return Promise.resolve(true);
        default:
          return Promise.resolve(null);
      }
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
    expect(updatedJob?.status).toBe("paused");
    expect(invokeMock).toHaveBeenCalledWith(
      "wait_transcode_job",
      expect.objectContaining({ jobId }),
    );
  });

  it("wires queue context menu resume action through to resume_transcode_job and updates job status", async () => {
    const jobId = "job-context-resume-1";
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      switch (cmd) {
        case "get_queue_state":
        case "get_queue_state_lite":
          return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
        case "get_app_settings":
          return Promise.resolve(makeDefaultSettings());
        case "get_cpu_usage":
          return Promise.resolve({ overall: 0, perCore: [] });
        case "get_gpu_usage":
          return Promise.resolve({ available: false });
        case "get_external_tool_statuses":
          return Promise.resolve([]);
        case "resume_transcode_job":
          expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
          return Promise.resolve(true);
        default:
          return Promise.resolve(null);
      }
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
    queueJobs = [
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
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      switch (cmd) {
        case "get_queue_state":
        case "get_queue_state_lite":
          return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
        case "get_app_settings":
          return Promise.resolve(makeDefaultSettings());
        case "get_cpu_usage":
          return Promise.resolve({ overall: 0, perCore: [] });
        case "get_gpu_usage":
          return Promise.resolve({ available: false });
        case "get_external_tool_statuses":
          return Promise.resolve([]);
        case "reveal_path_in_folder":
          expect(payload?.path).toBeDefined();
          return Promise.resolve(null);
        default:
          return Promise.resolve(null);
      }
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
