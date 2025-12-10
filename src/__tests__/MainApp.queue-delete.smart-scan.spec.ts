// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  i18n,
  useBackendMock,
  setQueueJobs,
  getQueueJobs,
  invokeMock,
  defaultAppSettings,
} from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp queue delete behaviour (Smart Scan batches)", () => {
  it("批次所有子任务均为终态时，Smart Scan 批次可以整体删除且不报错", async () => {
    const batchId = "batch-all-terminal";
    const jobs: TranscodeJob[] = [
      {
        id: "job-batch-completed-1",
        filename: "C:/videos/completed-1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "job-batch-skipped-2",
        filename: "C:/videos/completed-2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "p1",
        status: "skipped",
        progress: 100,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);

    const deletedIds: string[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_job: (payload) => {
        const id = (payload?.jobId ?? payload?.job_id) as string;
        deletedIds.push(id);
        return true;
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    setSelectedJobIds(vm, jobs.map((job) => job.id));

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_transcode_job").length,
    ).toBe(2);
    expect(new Set(deletedIds)).toEqual(new Set(jobs.map((job) => job.id)));

    const error = (vm.queueError ?? vm.queueError?.value) ?? null;
    expect(error).toBeNull();

    wrapper.unmount();
  });

  it("含有活跃子任务的批次会被跳过，其它安全批次和普通任务仍可删除并提示 deleteActiveNotAllowed", async () => {
    const safeBatchId = "batch-safe";
    const blockedBatchId = "batch-blocked";

    const jobs: TranscodeJob[] = [
      {
        id: "safe-completed-1",
        filename: "C:/videos/safe-1.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId: safeBatchId,
      } as any,
      {
        id: "safe-skipped-2",
        filename: "C:/videos/safe-2.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 12,
        originalCodec: "h264",
        presetId: "p1",
        status: "skipped",
        progress: 100,
        logs: [],
        batchId: safeBatchId,
      } as any,
      {
        id: "blocked-completed",
        filename: "C:/videos/blocked-completed.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 15,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId: blockedBatchId,
      } as any,
      {
        id: "blocked-processing",
        filename: "C:/videos/blocked-processing.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 20,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 30,
        logs: [],
        batchId: blockedBatchId,
      } as any,
      {
        id: "manual-completed",
        filename: "C:/videos/manual.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 8,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      } as any,
    ];

    setQueueJobs(jobs);

    const deletedIds: string[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_job: (payload) => {
        const id = (payload?.jobId ?? payload?.job_id) as string;
        deletedIds.push(id);
        return true;
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    setSelectedJobIds(vm, jobs.map((job) => job.id));

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    const deleteCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_transcode_job");
    expect(deleteCalls.length).toBe(3);
    expect(new Set(deletedIds)).toEqual(
      new Set(["safe-completed-1", "safe-skipped-2", "manual-completed"]),
    );

    const error = (vm.queueError ?? vm.queueError?.value) ?? null;
    const expected =
      (i18n as any).global.t("queue.error.deleteActiveNotAllowed") as string;
    expect(error).toBe(expected);

    const selected = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selected?.size ?? 0).toBe(0);

    wrapper.unmount();
  });

  it("当批次仍有非终态子任务时，Smart Scan 子任务删除被拒绝并提示 deleteActiveNotAllowed", async () => {
    const batchId = "batch-has-active";
    const jobs: TranscodeJob[] = [
      {
        id: "job-batch-completed",
        filename: "C:/videos/completed.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
        batchId,
      } as any,
      {
        id: "job-batch-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "smart_scan",
        originalSizeMB: 20,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 20,
        logs: [],
        batchId,
      } as any,
    ];

    setQueueJobs(jobs);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_job: () => {
        throw new Error("delete_transcode_job should not be called when batch has active jobs");
      },
    });

    const wrapper = mount(MainApp, {
      global: { plugins: [i18n] },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    await nextTick();
    if (typeof vm.refreshQueueFromBackend === "function") {
      await vm.refreshQueueFromBackend();
    }
    await nextTick();

    setSelectedJobIds(vm, ["job-batch-completed"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_job"),
    ).toBe(false);

    const error =
      (vm.queueError ?? vm.queueError?.value) ??
      null;
    const expected =
      (i18n as any).global.t(
        "queue.error.deleteActiveNotAllowed",
      ) as string;
    expect(error).toBe(expected);

    const selected = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selected?.size ?? 0).toBe(0);

    wrapper.unmount();
  });
});
