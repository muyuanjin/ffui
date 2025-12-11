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

describe("MainApp queue ordering helpers", () => {
  it("bulkMoveSelectedJobsToTop reorders waiting queue via reorder_queue", async () => {
    queueJobs = [
      {
        id: "waiting-1",
        filename: "a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 0,
      } as TranscodeJob,
      {
        id: "waiting-2",
        filename: "b.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
        queueOrder: 1,
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite") {
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      }
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "reorder_queue") {
        const ids = payload?.jobIds ?? payload?.job_ids;
        expect(ids).toEqual(["waiting-1", "waiting-2"]);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    vm.jobs = queueJobs;
    vm.selectedJobIds = new Set(["waiting-2", "waiting-1"]);
    await vm.bulkMoveSelectedJobsToTop();

    expect(invokeMock).toHaveBeenCalledWith(
      "reorder_queue",
      expect.objectContaining({ jobIds: ["waiting-1", "waiting-2"] }),
    );
  });

  it("waiting row context menu moves a job to the top of the waiting queue via reorder_queue", async () => {
    queueJobs = [
      {
        id: "waiting-1",
        filename: "a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
      } as TranscodeJob,
      {
        id: "waiting-2",
        filename: "b.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        logs: [],
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite") {
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      }
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "reorder_queue") {
        const ids = payload?.jobIds ?? payload?.job_ids;
        expect(ids).toEqual(["waiting-2", "waiting-1"]);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    vm.jobs = queueJobs;
    await vm.moveJobToTop("waiting-2");

    expect(invokeMock).toHaveBeenCalledWith(
      "reorder_queue",
      expect.objectContaining({ jobIds: ["waiting-2", "waiting-1"] }),
    );
  });

  it("single Smart Scan child move-to-top reorders within batch only", async () => {
    queueJobs = [
      {
        id: "manual-1",
        filename: "m1.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        queueOrder: 0,
      } as TranscodeJob,
      {
        id: "batch1-a",
        filename: "a.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        batchId: "batch-1",
        queueOrder: 1,
      } as TranscodeJob,
      {
        id: "batch1-b",
        filename: "b.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        batchId: "batch-1",
        queueOrder: 2,
      } as TranscodeJob,
      {
        id: "manual-2",
        filename: "m2.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        queueOrder: 3,
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite") {
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      }
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "reorder_queue") {
        const ids = payload?.jobIds ?? payload?.job_ids;
        expect(ids).toEqual(["manual-1", "batch1-b", "batch1-a", "manual-2"]);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    vm.jobs = queueJobs;
    vm.selectedJobIds = new Set(["batch1-b"]);
    await vm.bulkMoveSelectedJobsToTop();

    expect(invokeMock).toHaveBeenCalledWith(
      "reorder_queue",
      expect.objectContaining({ jobIds: ["manual-1", "batch1-b", "batch1-a", "manual-2"] }),
    );
  });

  it("Smart Scan batch move-to-top moves the whole batch globally", async () => {
    queueJobs = [
      {
        id: "manual-1",
        filename: "m1.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        queueOrder: 0,
      } as TranscodeJob,
      {
        id: "batch1-a",
        filename: "a.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        batchId: "batch-1",
        queueOrder: 1,
      } as TranscodeJob,
      {
        id: "batch1-b",
        filename: "b.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        batchId: "batch-1",
        queueOrder: 2,
      } as TranscodeJob,
      {
        id: "manual-2",
        filename: "m2.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "waiting",
        progress: 0,
        queueOrder: 3,
      } as TranscodeJob,
    ];

    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "get_queue_state" || cmd === "get_queue_state_lite") {
        return Promise.resolve({ jobs: queueJobs } satisfies QueueState);
      }
      if (cmd === "get_app_settings") return Promise.resolve(makeDefaultSettings());
      if (cmd === "get_cpu_usage") return Promise.resolve({ overall: 0, perCore: [] });
      if (cmd === "get_gpu_usage") return Promise.resolve({ available: false });
      if (cmd === "get_external_tool_statuses") return Promise.resolve([]);
      if (cmd === "reorder_queue") {
        const ids = payload?.jobIds ?? payload?.job_ids;
        expect(ids).toEqual(["batch1-a", "batch1-b", "manual-1", "manual-2"]);
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();

    vm.jobs = queueJobs;
    vm.selectedJobIds = new Set(["batch1-a", "batch1-b"]);
    await vm.bulkMoveSelectedJobsToTop();

    expect(invokeMock).toHaveBeenCalledWith(
      "reorder_queue",
      expect.objectContaining({ jobIds: ["batch1-a", "batch1-b", "manual-1", "manual-2"] }),
    );
  });
});
