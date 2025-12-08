import { beforeEach, vi } from "vitest";
import { createI18n } from "vue-i18n";
import type {
  AppSettings,
  AutoCompressResult,
  TranscodeJob,
} from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

export const dialogOpenMock = vi.fn();
export const invokeMock = vi.fn<
  (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>
>();
export const listenMock = vi.fn<
  (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>
>();

let queueStateHandler: ((event: { payload: unknown }) => void) | null = null;
let smartScanProgressHandler: ((event: { payload: unknown }) => void) | null = null;
let queueJobs: TranscodeJob[] = [];

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options: Record<string, unknown>) => dialogOpenMock(options),
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

export const i18n = createI18n({
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
    smartScanDefaults: {
      minImageSizeKB: overrides.smartScanDefaults?.minImageSizeKB ?? 50,
      minVideoSizeMB: overrides.smartScanDefaults?.minVideoSizeMB ?? 50,
      minSavingRatio: overrides.smartScanDefaults?.minSavingRatio ?? 0.95,
      imageTargetFormat: overrides.smartScanDefaults?.imageTargetFormat ?? "avif",
      videoPresetId: overrides.smartScanDefaults?.videoPresetId ?? "",
    },
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
  queueStateHandler?.({ payload: { jobs } });
}

export function emitSmartScanProgress(progress: unknown): void {
  smartScanProgressHandler?.({ payload: progress });
}

export function getQueueStateHandler() {
  return queueStateHandler;
}

export function getSmartScanProgressHandler() {
  return smartScanProgressHandler;
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
    default:
      return null;
  }
}

export function useBackendMock(
  overrides: Record<string, (payload?: Record<string, unknown>) => unknown>,
): void {
  invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
    const handler =
      overrides[cmd] ??
      // Treat the lite queue state command as an alias for the existing
      // full queue state handler in tests so older specs keep working.
      (cmd === "get_queue_state_lite" ? overrides["get_queue_state"] : undefined);
    if (handler) {
      return Promise.resolve(handler(payload));
    }
    return Promise.resolve(defaultBackendResponse(cmd));
  });
}

beforeEach(() => {
  (window as any).__TAURI_IPC__ = {};
  dialogOpenMock.mockReset();
  invokeMock.mockReset();
  listenMock.mockReset();
  queueJobs = [];
  queueStateHandler = null;
  smartScanProgressHandler = null;

  listenMock.mockImplementation(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://queue-state" || event === "ffui://queue-state-lite") {
        queueStateHandler = handler;
      } else if (event === "auto-compress://progress") {
        smartScanProgressHandler = handler;
      }
      return () => {};
    },
  );
});
