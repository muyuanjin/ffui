import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { TranscodeJob, QueueState, AppSettings, AutoCompressResult } from "@/types";
import MainApp from "@/MainApp.vue";

const dialogOpenMock = vi.fn();
let queueJobs: TranscodeJob[] = [];
const invokeMock = vi.fn<
  (cmd: string, payload: Record<string, unknown> | undefined) => Promise<unknown>
>();
const listenMock = vi.fn<
  (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>
>();

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: (options: Record<string, unknown>) => dialogOpenMock(options),
  };
});

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
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
    hasTauri: () => true,
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

let queueStateHandler: ((event: { payload: unknown }) => void) | null = null;

beforeEach(() => {
  (window as any).__TAURI_IPC__ = {};
  dialogOpenMock.mockReset();
  invokeMock.mockReset();
  listenMock.mockReset();
  queueJobs = [];
  queueStateHandler = null;

  listenMock.mockImplementation(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "transcoding://queue-state") {
        queueStateHandler = handler;
      }
      return () => {};
    },
  );
});

describe("MainApp Tauri manual job flow via dialog", () => {
  it("uses dialog.open and enqueueTranscodeJob to add a manual job", async () => {
    const selectedPath = "C:/videos/sample.mp4";

    dialogOpenMock.mockResolvedValueOnce(selectedPath);

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queueJobs };
            return Promise.resolve(state);
          }
          case "get_app_settings": {
            const settings: AppSettings = {
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
            };
            return Promise.resolve(settings);
          }
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
          case "run_auto_compress": {
            const result: AutoCompressResult = {
              rootPath: (payload?.rootPath as string) ?? "",
              jobs: [],
              totalFilesScanned: 0,
              totalCandidates: 0,
              totalProcessed: 0,
            };
            return Promise.resolve(result);
          }
          case "save_app_settings":
            return Promise.resolve(payload?.settings);
          case "enqueue_transcode_job": {
            const job: TranscodeJob = {
              id: "job-1",
              filename: (payload?.filename as string) ?? "",
              type: ((payload?.jobType as string) ?? "video") as TranscodeJob["type"],
              source: (payload?.source as TranscodeJob["source"]) ?? "manual",
              originalSizeMB: (payload?.originalSizeMb as number) ?? 0,
              originalCodec: (payload?.originalCodec as string) ?? "h264",
              presetId: (payload?.presetId as string) ?? "preset-1",
              status: "waiting",
              progress: 0,
              logs: [],
            };
            // Simulate the backend queue being updated and a push event firing
            // before the enqueue command resolves.
            queueJobs = [job, ...queueJobs];
            queueStateHandler?.({ payload: { jobs: queueJobs } });
            return Promise.resolve(job);
          }
          case "cancel_transcode_job":
            return Promise.resolve(true);
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
    const initialJobs = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(initialJobs.length).toBe(0);

    await vm.addManualJob();
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].filename).toBe(selectedPath);

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    const [options] = dialogOpenMock.mock.calls[0];
    expect(options).toMatchObject({
      multiple: false,
      directory: false,
    });

    const invokeCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "enqueue_transcode_job",
    );
    expect(invokeCalls.length).toBe(1);
    const [, payload] = invokeCalls[0];
    expect(payload).toMatchObject({
      filename: selectedPath,
      source: "manual",
    });
  });

});
