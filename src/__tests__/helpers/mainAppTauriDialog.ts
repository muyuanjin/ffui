import { beforeEach, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type { AppSettings, AutoCompressResult, TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import { buildBatchCompressDefaults } from "./batchCompressDefaults";

export const dialogOpenMock = vi.fn();
export const dialogMessageMock = vi.fn();
export const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();
export const listenMock =
  vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>();

let queueStateHandler: ((event: { payload: unknown }) => void) | null = null;
let batchCompressProgressHandler: ((event: { payload: unknown }) => void) | null = null;
let dragDropHandler: ((event: { payload: { paths: string[] } }) => void) | null = null;
let queueJobs: TranscodeJob[] = [];

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options: Record<string, unknown>) => dialogOpenMock(options),
  message: (message: string, options?: Record<string, unknown>) => dialogMessageMock(message, options),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
}));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
  };
});

export const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

export function defaultAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  const tools = overrides.tools ?? {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: false,
    autoUpdate: false,
  };

  return {
    tools: {
      ffmpegPath: tools.ffmpegPath ?? undefined,
      ffprobePath: tools.ffprobePath ?? undefined,
      avifencPath: tools.avifencPath ?? undefined,
      autoDownload: tools.autoDownload ?? false,
      autoUpdate: tools.autoUpdate ?? false,
    },
    batchCompressDefaults: buildBatchCompressDefaults(overrides.batchCompressDefaults),
    previewCapturePercent: overrides.previewCapturePercent ?? 25,
    defaultQueuePresetId: overrides.defaultQueuePresetId,
    maxParallelJobs: overrides.maxParallelJobs,
    progressUpdateIntervalMs: overrides.progressUpdateIntervalMs,
    taskbarProgressMode: overrides.taskbarProgressMode ?? "byEstimatedTime",
  } as AppSettings;
}

export function buildAutoCompressResult(
  rootPath: string,
  overrides: Partial<AutoCompressResult> = {},
): AutoCompressResult {
  return {
    rootPath,
    jobs: [],
    totalFilesScanned: 0,
    totalCandidates: 0,
    totalProcessed: 0,
    batchId: overrides.batchId ?? "auto-compress-test-batch",
    startedAtMs: Date.now(),
    completedAtMs: Date.now(),
    ...overrides,
  };
}

export function getQueueJobs(): TranscodeJob[] {
  return queueJobs;
}

export function setQueueJobs(jobs: TranscodeJob[]): void {
  queueJobs = jobs;
}

export function appendQueueJob(job: TranscodeJob): TranscodeJob[] {
  queueJobs = [job, ...queueJobs];
  return queueJobs;
}

export function emitQueueState(jobs: TranscodeJob[]): void {
  // Keep the mocked "get_queue_state(_lite)" source of truth in sync with
  // event-driven updates so tests model the real backend behaviour.
  queueJobs = jobs;
  queueStateHandler?.({ payload: { jobs } });
}

export function emitBatchCompressProgress(progress: unknown): void {
  batchCompressProgressHandler?.({ payload: progress });
}

export function emitDragDrop(paths: string[]): void {
  dragDropHandler?.({ payload: { paths } });
}

export function getQueueStateHandler() {
  return queueStateHandler;
}

export function getBatchCompressProgressHandler() {
  return batchCompressProgressHandler;
}

export function defaultBackendResponse(cmd: string): unknown {
  switch (cmd) {
    case "get_queue_state_lite":
    case "get_queue_state":
      return { jobs: queueJobs };
    case "get_app_settings":
      return defaultAppSettings();
    case "get_cpu_usage":
      return { overall: 0, perCore: [] };
    case "get_gpu_usage":
      return { available: false };
    case "get_external_tool_statuses":
      return [];
    case "get_external_tool_statuses_cached":
      return [];
    case "refresh_external_tool_statuses_async":
      return true;
    default:
      return null;
  }
}

export function useBackendMock(overrides: Record<string, (payload?: Record<string, unknown>) => unknown>): void {
  invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
    const handler =
      overrides[cmd] ??
      // Treat the lite queue state command as an alias for the existing
      // full queue state handler in tests so older specs keep working.
      (cmd === "get_queue_state_lite" ? overrides["get_queue_state"] : undefined);
    if (handler) {
      return Promise.resolve(handler(payload));
    }
    if (cmd === "expand_manual_job_inputs") {
      const raw = (payload?.paths ?? payload?.inputPaths ?? payload?.input_paths) as unknown;
      if (Array.isArray(raw)) {
        return Promise.resolve(raw.filter((p) => typeof p === "string" && p.length > 0));
      }
      return Promise.resolve([]);
    }
    return Promise.resolve(defaultBackendResponse(cmd));
  });
}

beforeEach(() => {
  (window as any).__TAURI_IPC__ = {};
  dialogOpenMock.mockReset();
  dialogMessageMock.mockReset();
  invokeMock.mockReset();
  listenMock.mockReset();
  queueJobs = [];
  queueStateHandler = null;
  batchCompressProgressHandler = null;
  dragDropHandler = null;

  listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (event === "ffui://queue-state" || event === "ffui://queue-state-lite") {
      queueStateHandler = handler;
    } else if (event === "auto-compress://progress") {
      batchCompressProgressHandler = handler;
    } else if (event === "tauri://drag-drop") {
      dragDropHandler = handler as any;
    }
    return () => {};
  });
});
