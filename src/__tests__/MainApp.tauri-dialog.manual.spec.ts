// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextTick } from "vue";
import {
  appendQueueJob,
  defaultAppSettings,
  dialogOpenMock,
  listenMock,
  emitQueueState,
  emitDragDrop,
  i18n,
  invokeMock,
  getQueueJobs,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { mount } from "@vue/test-utils";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp Tauri manual job flow", () => {
  it("uses dialog.open and enqueueTranscodeJob to add a manual job", async () => {
    const selectedPath = "C:/videos/sample.mp4";
    setQueueJobs([]);
    dialogOpenMock.mockResolvedValueOnce(selectedPath);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_presets: () => [
        {
          id: "p1",
          name: "Default",
          description: "Default preset",
          video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
          audio: { codec: "copy" },
          filters: {},
          stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
        },
        {
          id: "p2",
          name: "Archive Master",
          description: "Test preset",
          video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
          audio: { codec: "copy" },
          filters: {},
          stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
        },
      ],
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      run_auto_compress: () => null,
      save_app_settings: ({ settings } = {}) => settings,
      enqueue_transcode_job: (payload) => {
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
        appendQueueJob(job);
        emitQueueState(getQueueJobs());
        return job;
      },
    });

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    await nextTick();
    vm.manualJobPresetId = "p2";

    const initialJobs = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(initialJobs.length).toBe(0);

    await vm.addManualJob("files");
    await nextTick();
    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
      await nextTick();
    }

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].filename).toBe(selectedPath);

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    const [options] = dialogOpenMock.mock.calls[0];
    expect(options).toMatchObject({ multiple: true, directory: false, recursive: false });

    const invokeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "enqueue_transcode_job");
    expect(invokeCalls.length).toBe(1);
    const [, payload] = invokeCalls[0];
    expect(payload).toMatchObject({
      filename: selectedPath,
      source: "manual",
      presetId: "p2",
    });

    wrapper.unmount();
  });

  it("enqueues multiple selected files in picker order and filters non-video inputs", async () => {
    const selectedPaths = ["C:/videos/02.mp4", "C:/videos/01.txt", "C:/videos/03.mkv"];
    dialogOpenMock.mockResolvedValueOnce(selectedPaths);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_presets: () => [
        {
          id: "p2",
          name: "Archive Master",
          description: "Test preset",
          video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
          audio: { codec: "copy" },
          filters: {},
          stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
        },
      ],
      expand_manual_job_inputs: (payload) => {
        const paths = (payload?.paths as string[]) ?? [];
        return paths.filter((p) => p.endsWith(".mp4") || p.endsWith(".mkv"));
      },
      enqueue_transcode_jobs: () => null,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();
    vm.manualJobPresetId = "p2";

    await vm.addManualJob("files");
    await nextTick();
    await nextTick();

    const enqueues = invokeMock.mock.calls.filter(([cmd]) => cmd === "enqueue_transcode_jobs");
    expect(enqueues.length).toBe(1);
    expect(enqueues[0][1]).toMatchObject({
      filenames: ["C:/videos/02.mp4", "C:/videos/03.mkv"],
    });

    wrapper.unmount();
  });

  it("supports selecting a folder and never enqueues the directory path itself", async () => {
    const folder = "C:/videos/folder";
    dialogOpenMock.mockResolvedValueOnce(folder);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_presets: () => [
        {
          id: "p2",
          name: "Archive Master",
          description: "Test preset",
          video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
          audio: { codec: "copy" },
          filters: {},
          stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
        },
      ],
      expand_manual_job_inputs: () => ["C:/videos/folder/a.mp4", "C:/videos/folder/b.mkv"],
      enqueue_transcode_jobs: () => null,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await nextTick();
    vm.manualJobPresetId = "p2";

    await vm.addManualJob("folder");
    await nextTick();
    await nextTick();

    expect(dialogOpenMock).toHaveBeenCalledTimes(1);
    expect(dialogOpenMock.mock.calls[0][0]).toMatchObject({ directory: true, recursive: true });

    const enqueues = invokeMock.mock.calls.filter(([cmd]) => cmd === "enqueue_transcode_jobs");
    expect(enqueues.length).toBe(1);
    const [, payload] = enqueues[0];
    expect(payload).toMatchObject({
      filenames: ["C:/videos/folder/a.mp4", "C:/videos/folder/b.mkv"],
    });
    expect((payload as any).filenames).not.toContain(folder);

    wrapper.unmount();
  });

  it("expands dropped directories into enqueued files", async () => {
    setQueueJobs([]);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      expand_manual_job_inputs: () => ["C:/dropped/a.mp4", "C:/dropped/b.mkv"],
      enqueue_transcode_jobs: (payload) => {
        const filenames = (payload?.filenames as string[]) ?? [];
        const presetId = (payload?.presetId as string) ?? "p1";
        for (const filename of filenames) {
          appendQueueJob({
            id: `job-${Date.now()}-${filename}`,
            filename,
            type: "video",
            source: "manual",
            originalSizeMB: 0,
            originalCodec: "h264",
            presetId,
            status: "waiting",
            progress: 0,
            logs: [],
          } as any);
        }
        emitQueueState(getQueueJobs());
        return [];
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await nextTick();
    await nextTick();

    const subscribed = listenMock.mock.calls.some(([event]) => event === "tauri://drag-drop");
    expect(subscribed).toBe(true);

    emitDragDrop(["C:/dropped"]);
    await nextTick();
    await nextTick();
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }

    const enqueues = invokeMock.mock.calls.filter(([cmd]) => cmd === "enqueue_transcode_jobs");
    expect(enqueues.length).toBe(1);
    expect(enqueues[0][1]).toMatchObject({
      filenames: ["C:/dropped/a.mp4", "C:/dropped/b.mkv"],
    });

    wrapper.unmount();
  });

  it("marks processing jobs as cancelled in Tauri mode after cancelTranscodeJob succeeds", async () => {
    const jobId = "job-cancel-1";
    setQueueJobs([
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
    ]);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      cancel_transcode_job: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        return true;
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    const jobsBefore = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsBefore.length).toBe(1);
    expect(jobsBefore[0].status).toBe("processing");

    await vm.handleCancelJob(jobId);
    await nextTick();

    const jobsAfter = Array.isArray(vm.jobs) ? vm.jobs : vm.jobs?.value ?? [];
    expect(jobsAfter.length).toBe(1);
    const jobAfter = jobsAfter[0];
    expect(jobAfter.status).toBe("cancelled");
    const hasUiCancellationLog = jobAfter.logs.some((line: string) =>
      line.includes("Cancellation requested from UI; waiting for backend to stop ffmpeg"),
    );
    expect(hasUiCancellationLog).toBe(true);

    wrapper.unmount();
  });
});
