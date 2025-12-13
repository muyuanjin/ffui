// @vitest-environment jsdom
/**
 * 测试暂停/继续操作的竞态条件处理。
 * 
 * 当用户快速连续点击"暂停→继续"时，可能出现以下情况：
 * 1. 用户点击暂停 → wait_requests 被设置，任务仍是 Processing
 * 2. 用户立即点击继续 → 后端检测到待处理的暂停请求并取消它
 * 3. 任务继续正常处理，不会卡住
 */
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

describe("MainApp rapid pause/resume race condition handling", () => {
  it("handles resume on processing job when backend cancels pending wait request", async () => {
    // 测试场景：用户快速点击"暂停→继续"，后端取消待处理的暂停请求
    // 后端返回 true 表示成功取消了暂停请求，任务继续处理
    const jobId = "job-rapid-resume-1";
    queueJobs = [
      {
        id: jobId,
        filename: "C:/videos/rapid-resume.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing", // 任务仍在处理中
        progress: 30,
        logs: [],
      } as TranscodeJob,
    ];

    let resumeCalled = false;

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
        case "get_external_tool_statuses_cached":
          return Promise.resolve([]);
        case "refresh_external_tool_statuses_async":
          return Promise.resolve(true);
        case "resume_transcode_job":
          // 后端返回 true 表示成功取消了待处理的暂停请求
          expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
          resumeCalled = true;
          return Promise.resolve(true);
        default:
          return Promise.resolve(null);
      }
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    // 模拟用户在任务处理中时调用 resume（可能是快速点击暂停后立即点击继续）
    // 前端当前实现会检查状态是否为 paused，但后端现在也支持取消待处理的暂停请求
    // 这个测试验证后端返回 true 时前端不会报错
    await vm.handleResumeJob(jobId);
    await nextTick();

    // 验证 resume 命令被调用
    expect(resumeCalled).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      "resume_transcode_job",
      expect.objectContaining({ jobId }),
    );
    // 前端不应该显示错误
    expect(vm.queueError).toBeNull();
  });

  it("handles resume rejection when job is processing without pending wait request", async () => {
    // 测试场景：对正在处理且没有待处理暂停请求的任务调用 resume
    // 后端返回 false，前端应该显示错误
    const jobId = "job-no-pending-wait-1";
    queueJobs = [
      {
        id: jobId,
        filename: "C:/videos/no-pending-wait.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 50,
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
        case "get_external_tool_statuses_cached":
          return Promise.resolve([]);
        case "refresh_external_tool_statuses_async":
          return Promise.resolve(true);
        case "resume_transcode_job":
          // 后端返回 false 表示任务不是 Paused 状态且没有待处理的暂停请求
          expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
          return Promise.resolve(false);
        default:
          return Promise.resolve(null);
      }
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    await vm.handleResumeJob(jobId);
    await nextTick();

    // 验证前端显示了错误消息
    expect(vm.queueError).toBeTruthy();
  });
});
