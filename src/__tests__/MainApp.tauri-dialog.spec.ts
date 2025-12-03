import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type {
  TranscodeJob,
  QueueState,
  AppSettings,
  AutoCompressResult,
  AutoCompressProgress,
  FFmpegPreset,
} from "@/types";
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
let smartScanProgressHandler: ((event: { payload: unknown }) => void) | null =
  null;

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
      if (event === "transcoding://queue-state") {
        queueStateHandler = handler;
      } else if (event === "auto-compress://progress") {
        smartScanProgressHandler = handler;
      }
      return () => {};
    },
  );
});

describe("MainApp Tauri manual job flow via dialog", () => {
  it("uses a directory dialog to choose Smart Scan root in Tauri mode", async () => {
    const selectedRoot = "C:/videos/batch";

    dialogOpenMock.mockResolvedValueOnce(selectedRoot);

    invokeMock.mockImplementation((cmd: string): Promise<unknown> => {
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
              previewCapturePercent: 25,
            };
            return Promise.resolve(settings);
          }
          case "get_cpu_usage":
            return Promise.resolve({ overall: 0, perCore: [] });
          case "get_gpu_usage":
            return Promise.resolve({ available: false });
          case "get_external_tool_statuses":
            return Promise.resolve([]);
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

    expect(vm.lastDroppedRoot).toBe(null);
    expect(vm.showSmartScan).toBe(false);

    await vm.startSmartScan();
    await nextTick();

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    const [options] = dialogOpenMock.mock.calls[0];
    expect(options).toMatchObject({
      multiple: false,
      directory: true,
    });

    expect(vm.lastDroppedRoot).toBe(selectedRoot);
    expect(vm.showSmartScan).toBe(true);
    expect(vm.activeTab).toBe("queue");

    wrapper.unmount();
  });

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
              previewCapturePercent: 25,
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
              batchId: "auto-compress-test-batch",
              startedAtMs: Date.now(),
              completedAtMs: Date.now(),
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

    // Explicitly pick a non-default preset id to ensure the manual job flow
    // honours the user's preset selection from the queue header.
    (vm as any).manualJobPresetId = "p2";

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
      presetId: "p2",
    });
  });

  it("marks processing jobs as cancelled in Tauri mode after cancelTranscodeJob succeeds", async () => {
    const jobId = "job-cancel-1";

    // Seed a single processing job in the mocked backend queue.
    queueJobs = [
      {
        id: jobId,
        filename: "C:/videos/stream.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 10,
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
              previewCapturePercent: 25,
            };
            return Promise.resolve(settings);
          }
          case "cancel_transcode_job":
            expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
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

    // Explicitly hydrate jobs from the mocked get_queue_state response so we
    // do not depend on the timing of the onMounted lifecycle hook.
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    const jobsBefore = Array.isArray(vm.jobs)
      ? vm.jobs
      : vm.jobs?.value ?? [];
    expect(jobsBefore.length).toBe(1);
    expect(jobsBefore[0].status).toBe("processing");

    await vm.handleCancelJob(jobId);
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs)
      ? vm.jobs
      : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    const jobAfter = jobsAfter[0];
    expect(jobAfter.status).toBe("cancelled");
    const hasUiCancellationLog = jobAfter.logs.some((line: string) =>
      line.includes("Cancellation requested from UI; waiting for backend to stop ffmpeg"),
    );
    expect(hasUiCancellationLog).toBe(true);

    wrapper.unmount();
  });

  it("saves new presets to the backend before using them for manual jobs", async () => {
    const selectedPath = "C:/videos/custom-preset.mp4";

    const backendPresets: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: {
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 23,
          preset: "medium",
        },
        audio: {
          codec: "copy",
        },
        filters: {
          scale: "-2:1080",
        },
        stats: {
          usageCount: 5,
          totalInputSizeMB: 2500,
          totalOutputSizeMB: 800,
          totalTimeSeconds: 420,
        },
      },
      {
        id: "p2",
        name: "Archive Master",
        description: "x264 Slow CRF 18. Near lossless.",
        video: {
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 18,
          preset: "slow",
        },
        audio: {
          codec: "copy",
        },
        filters: {},
        stats: {
          usageCount: 2,
          totalInputSizeMB: 5000,
          totalOutputSizeMB: 3500,
          totalTimeSeconds: 1200,
        },
      },
    ];

    let queue: TranscodeJob[] = [];

    dialogOpenMock.mockResolvedValueOnce(selectedPath);

    invokeMock.mockImplementation(
      (cmd: string, payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: queue };
            return Promise.resolve(state);
          }
          case "get_presets":
            return Promise.resolve(backendPresets);
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
              previewCapturePercent: 25,
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
              batchId: "auto-compress-test-batch",
              startedAtMs: Date.now(),
              completedAtMs: Date.now(),
            };
            return Promise.resolve(result);
          }
          case "save_app_settings":
            return Promise.resolve(payload?.settings);
          case "save_preset": {
            const preset = payload?.preset as FFmpegPreset;
            const existingIndex = backendPresets.findIndex((p) => p.id === preset.id);
            if (existingIndex >= 0) {
              backendPresets[existingIndex] = preset;
            } else {
              backendPresets.push(preset);
            }
            return Promise.resolve(backendPresets);
          }
          case "enqueue_transcode_job": {
            const presetId = (payload?.presetId as string) ?? "";
            // If this ever fails, it means the UI enqueued a job with a preset id
            // that the backend does not know about, reproducing the original bug.
            expect(
              backendPresets.some((p) => p.id === presetId),
            ).toBe(true);

            const job: TranscodeJob = {
              id: "job-custom-1",
              filename: (payload?.filename as string) ?? "",
              type: ((payload?.jobType as string) ?? "video") as TranscodeJob["type"],
              source: (payload?.source as TranscodeJob["source"]) ?? "manual",
              originalSizeMB: (payload?.originalSizeMb as number) ?? 0,
              originalCodec: (payload?.originalCodec as string) ?? "h264",
              presetId,
              status: "waiting",
              progress: 0,
              logs: [],
            };
            queue = [job, ...queue];
            queueStateHandler?.({ payload: { jobs: queue } });
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

    const newPreset: FFmpegPreset = {
      id: "custom-preset-1",
      name: "Custom Preset 1",
      description: "User defined preset",
      video: {
        encoder: "libx264",
        rateControl: "crf",
        qualityValue: 22,
        preset: "fast",
      },
      audio: {
        codec: "aac",
        bitrate: 192,
      },
      filters: {},
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };

    await vm.handleSavePreset(newPreset);
    // 使用新建预设作为队列默认预设
    vm.manualJobPresetId = newPreset.id;

    await vm.addManualJob();
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].presetId).toBe(newPreset.id);

    const savePresetCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "save_preset",
    );
    const enqueueCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "enqueue_transcode_job",
    );

    expect(savePresetCalls.length).toBe(1);
    expect(enqueueCalls.length).toBe(1);

    const firstSaveIndex = invokeMock.mock.calls.findIndex(
      ([cmd]) => cmd === "save_preset",
    );
    const firstEnqueueIndex = invokeMock.mock.calls.findIndex(
      ([cmd]) => cmd === "enqueue_transcode_job",
    );

    expect(firstSaveIndex).toBeLessThan(firstEnqueueIndex);

    wrapper.unmount();
  });

  it("subscribes to queue-state stream and updates progress from events", async () => {
    const jobId = "job-stream-1";

    queueJobs = [
      {
        id: jobId,
        filename: "C:/videos/progress.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 100,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 0,
        logs: [],
      },
    ];

    invokeMock.mockImplementation(
      (cmd: string, _payload?: Record<string, unknown>): Promise<unknown> => {
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
              previewCapturePercent: 25,
            };
            return Promise.resolve(settings);
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

    // Hydrate initial jobs from the mocked backend queue.
    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    const jobsBefore = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsBefore.length).toBe(1);
    expect(jobsBefore[0].progress).toBe(0);

    // Simulate the backend emitting a progress update over the event stream.
    queueJobs = [
      {
        ...queueJobs[0],
        progress: 65,
      },
    ];
    queueStateHandler?.({ payload: { jobs: queueJobs } });
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].progress).toBe(65);

    wrapper.unmount();
  });

  it("subscribes to Smart Scan progress events and updates batch metadata", async () => {
    invokeMock.mockImplementation(
      (cmd: string, _payload?: Record<string, unknown>): Promise<unknown> => {
        switch (cmd) {
          case "get_queue_state": {
            const state: QueueState = { jobs: [] };
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
              previewCapturePercent: 25,
            };
            return Promise.resolve(settings);
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

    // Ensure listeners are registered.
    await nextTick();

    expect(typeof smartScanProgressHandler).toBe("function");

    const progress: AutoCompressProgress = {
      rootPath: "C:/videos/batch",
      totalFilesScanned: 10,
      totalCandidates: 4,
      totalProcessed: 2,
      batchId: "auto-compress-test-batch",
    };

    smartScanProgressHandler?.({ payload: progress });
    await nextTick();

    const meta = vm.smartScanBatchMeta["auto-compress-test-batch"];
    expect(meta).toBeTruthy();
    expect(meta.rootPath).toBe("C:/videos/batch");
    expect(meta.totalFilesScanned).toBe(10);
    expect(meta.totalCandidates).toBe(4);
    expect(meta.totalProcessed).toBe(2);

    wrapper.unmount();
  });
});
