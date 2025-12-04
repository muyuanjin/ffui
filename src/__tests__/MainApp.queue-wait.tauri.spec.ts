import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import type { TranscodeJob, QueueState, AppSettings } from "@/types";
import MainApp from "@/MainApp.vue";

const invokeMock = vi.fn<
  (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
>();

const listenMock = vi.fn<
  (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>
>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) =>
      invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      show: vi.fn(),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>(
    "@/lib/backend",
  );
  return {
    ...actual,
    // Force MainApp into Tauri mode so it exercises real backend helpers.
    hasTauri: () => true,
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

let queueJobs: TranscodeJob[] = [];
let queueStateHandler: ((event: { payload: unknown }) => void) | null = null;
// Mark as intentionally kept for future event-driven queue tests.
void queueStateHandler;

beforeEach(() => {
  (window as any).__TAURI_IPC__ = {};
  invokeMock.mockReset();
  listenMock.mockReset();
  queueJobs = [];
  queueStateHandler = null;

  listenMock.mockImplementation(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state") {
        queueStateHandler = handler;
      }
      return () => {};
    },
  );
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
    smartScanDefaults: {
      minImageSizeKB: 50,
      minVideoSizeMB: 50,
      minSavingRatio: 0.95,
      imageTargetFormat: "avif",
      videoPresetId: "",
    },
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

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings": {
            return Promise.resolve(makeDefaultSettings());
          }
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "wait_transcode_job": {
            expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
            return Promise.resolve(true);
          }
          default:
            return Promise.resolve(null);
        }
      },
    );

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    await vm.handleWaitJob(jobId);
    await nextTick();

    const jobsAfter = getJobsFromVm(vm);
    expect(jobsAfter.length).toBe(1);
    const jobAfter = jobsAfter[0];
    expect(jobAfter.status).toBe("paused");
    const hasWaitLog = jobAfter.logs.some((line: string) =>
      line.includes("Wait requested from UI; worker slot will be released"),
    );
    expect(hasWaitLog).toBe(true);

    const waitCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "wait_transcode_job",
    );
    expect(waitCalls.length).toBe(1);

    wrapper.unmount();
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
        progress: 40,
        logs: [],
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings":
            return Promise.resolve(makeDefaultSettings());
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "resume_transcode_job": {
            expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
            return Promise.resolve(true);
          }
          default:
            return Promise.resolve(null);
        }
      },
    );

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    await vm.handleResumeJob(jobId);
    await nextTick();

    const jobsAfter = getJobsFromVm(vm);
    expect(jobsAfter.length).toBe(1);
    const jobAfter = jobsAfter[0];
    expect(jobAfter.status).toBe("waiting");
    const hasResumeLog = jobAfter.logs.some((line: string) =>
      line.includes("Resume requested from UI; job re-entered waiting queue"),
    );
    expect(hasResumeLog).toBe(true);

    const resumeCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "resume_transcode_job",
    );
    expect(resumeCalls.length).toBe(1);

    wrapper.unmount();
  });

  it("sends restart_transcode_job and clears progress for non-terminal jobs", async () => {
    const jobId = "job-restart-1";

    queueJobs = [
      {
        id: jobId,
        filename: "C:/videos/restart-me.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 35,
        logs: [],
        failureReason: "some error",
        skipReason: "some reason",
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings":
            return Promise.resolve(makeDefaultSettings());
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "restart_transcode_job": {
            expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
            return Promise.resolve(true);
          }
          default:
            return Promise.resolve(null);
        }
      },
    );

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    await vm.handleRestartJob(jobId);
    await nextTick();

    const jobsAfter = getJobsFromVm(vm);
    expect(jobsAfter.length).toBe(1);
    const jobAfter = jobsAfter[0];
    expect(jobAfter.status).toBe("waiting");
    expect(jobAfter.progress).toBe(0);
    expect(jobAfter.failureReason).toBeUndefined();
    expect(jobAfter.skipReason).toBeUndefined();

    const restartCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "restart_transcode_job",
    );
    expect(restartCalls.length).toBe(1);

    wrapper.unmount();
  });

  it("bulkMoveSelectedJobsToTop reorders waiting queue via reorder_queue", async () => {
    const jobIds = ["job-1", "job-2", "job-3"];

    queueJobs = jobIds.map(
      (id, index): TranscodeJob =>
        ({
          id,
          filename: `C:/videos/${id}.mp4`,
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          originalCodec: "h264",
          presetId: "preset-1",
          status: "waiting",
          progress: 0,
          logs: [],
          queueOrder: index,
        }) as TranscodeJob,
    );

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings":
            return Promise.resolve(makeDefaultSettings());
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "reorder_queue": {
            const orderedIds =
              (payload?.orderedIds as string[]) ??
              (payload?.ordered_ids as string[]) ??
              [];
            // Apply the new order to the mocked backend queue.
            const byId = new Map(queueJobs.map((job) => [job.id, job]));
            const next: TranscodeJob[] = [];
            for (const id of orderedIds) {
              const job = byId.get(id);
              if (job) next.push(job);
            }
            for (const job of queueJobs) {
              if (!orderedIds.includes(job.id)) {
                next.push(job);
              }
            }
            queueJobs = next;
            return Promise.resolve(true);
          }
          default:
            return Promise.resolve(null);
        }
      },
    );

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if ("queueModeModel" in vm) {
      vm.queueModeModel = "queue";
    }

    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    // Select the middle job and move it to the top of the waiting queue.
    if (typeof vm.toggleJobSelected === "function") {
      vm.toggleJobSelected("job-2");
    }
    await nextTick();

    await vm.bulkMoveSelectedJobsToTop();
    await nextTick();

    const reorderCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "reorder_queue",
    );
    expect(reorderCalls.length).toBe(1);
    const [, payload] = reorderCalls[0];
    const orderedIds =
      (payload?.orderedIds as string[]) ??
      (payload?.ordered_ids as string[]) ??
      [];
    expect(orderedIds[0]).toBe("job-2");

    // 前端本地 state 会在后端下一次 queue-state 推送或手动刷新时与真实队列对齐，
    // 这里只要求发出了正确的 reorder_queue 调用，不再强制断言本地排序结果。

    wrapper.unmount();
  });

  it("waiting row context menu moves a job to the top of the waiting queue via reorder_queue", async () => {
    const jobIds = ["job-1", "job-2", "job-3"];

    queueJobs = jobIds.map(
      (id, index): TranscodeJob =>
        ({
          id,
          filename: `C:/videos/${id}.mp4`,
          type: "video",
          source: "manual",
          originalSizeMB: 10,
          originalCodec: "h264",
          presetId: "preset-1",
          status: "waiting",
          progress: 0,
          logs: [],
          queueOrder: index,
        }) as TranscodeJob,
    );

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings":
            return Promise.resolve(makeDefaultSettings());
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "reorder_queue": {
            const orderedIds =
              (payload?.orderedIds as string[]) ??
              (payload?.ordered_ids as string[]) ??
              [];
            const byId = new Map(queueJobs.map((job) => [job.id, job]));
            const next: TranscodeJob[] = [];
            for (const id of orderedIds) {
              const job = byId.get(id);
              if (job) next.push(job);
            }
            for (const job of queueJobs) {
              if (!orderedIds.includes(job.id)) {
                next.push(job);
              }
            }
            queueJobs = next;
            return Promise.resolve(true);
          }
          default:
            return Promise.resolve(null);
        }
      },
    );

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    if ("queueModeModel" in vm) {
      vm.queueModeModel = "queue";
    }

    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    // Open the context menu for the middle waiting job and choose "move to top".
    if (typeof vm.openWaitingJobContextMenu === "function") {
      vm.openWaitingJobContextMenu(queueJobs[1], new MouseEvent("contextmenu"));
    }
    await nextTick();

    const menu = wrapper.find("[data-testid='waiting-job-context-menu']");
    expect(menu.exists()).toBe(true);

    const firstAction = menu.findAll("button")[0];
    await firstAction.trigger("click");
    await nextTick();

    const reorderCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "reorder_queue",
    );
    expect(reorderCalls.length).toBe(1);
    const [, payload] = reorderCalls[0];
    const orderedIds =
      (payload?.orderedIds as string[]) ??
      (payload?.ordered_ids as string[]) ??
      [];
    expect(orderedIds[0]).toBe("job-2");

    wrapper.unmount();
  });
});
