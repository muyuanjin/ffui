// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  i18n,
  useBackendMock,
  setQueueJobs,
  getQueueJobs,
  emitQueueState,
  invokeMock,
  defaultAppSettings,
} from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp queue delete behaviour", () => {
  it("opens a confirm dialog for non-terminal jobs instead of failing deletion", async () => {
    const jobs: TranscodeJob[] = [
      {
        id: "job-processing",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 50,
        logs: [],
      } as any,
    ];

    setQueueJobs(jobs);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_jobs_bulk: () => {
        throw new Error("delete_transcode_jobs_bulk should not be called for active jobs");
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

    setSelectedJobIds(vm, ["job-processing"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    // No delete_transcode_job call should have been issued.
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_jobs_bulk")).toBe(false);

    const confirmOpen = vm.queueDeleteConfirmOpen ?? vm.queueDeleteConfirmOpen?.value;
    expect(confirmOpen).toBe(true);

    // No error banner should be surfaced until the user picks an action.
    const queueError = vm.queueError ?? vm.queueError?.value;
    expect(queueError == null).toBe(true);

    if (typeof vm.cancelQueueDeleteConfirm === "function") {
      vm.cancelQueueDeleteConfirm();
    }

    wrapper.unmount();
  });

  it("only deletes terminal jobs via backend and leaves active jobs alone", async () => {
    const jobs: TranscodeJob[] = [
      {
        id: "job-completed",
        filename: "C:/videos/completed.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      } as any,
      {
        id: "job-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 20,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        logs: [],
      } as any,
    ];

    setQueueJobs(jobs);

    const deletedIds: string[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_jobs_bulk: (payload) => {
        const ids = (payload?.jobIds ?? payload?.job_ids) as string[];
        deletedIds.push(...(ids ?? []));
        // 模拟后端在返回 true 时从队列中移除对应任务。
        const deletable = new Set(ids ?? []);
        setQueueJobs(getQueueJobs().filter((job) => !deletable.has(job.id)));
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

    // Select both jobs and trigger bulk delete.
    setSelectedJobIds(vm, ["job-completed", "job-processing"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    const confirmOpen = vm.queueDeleteConfirmOpen ?? vm.queueDeleteConfirmOpen?.value;
    expect(confirmOpen).toBe(true);
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_jobs_bulk")).toBe(false);

    if (typeof vm.confirmQueueDeleteTerminalOnly === "function") {
      await vm.confirmQueueDeleteTerminalOnly();
    }
    await nextTick();

    // The backend delete command should be called only for the completed job.
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_jobs_bulk")).toBe(true);
    expect(deletedIds).toContain("job-completed");
    expect(deletedIds).not.toContain("job-processing");

    // UI 队列中应只剩下仍在 processing 的任务。
    const uiJobs = (vm.queueJobsForDisplay ?? vm.queueJobsForDisplay?.value) as TranscodeJob[] | undefined;
    const remainingIds = (uiJobs ?? []).map((job) => job.id);
    expect(remainingIds).toContain("job-processing");
    expect(remainingIds).not.toContain("job-completed");

    const error = vm.queueError ?? vm.queueError?.value ?? null;
    expect(error).toBeNull();

    wrapper.unmount();
  });

  it("does not show deleteFailed when backend returns false but the job actually disappears from queue", async () => {
    const jobs: TranscodeJob[] = [
      {
        id: "job-completed",
        filename: "C:/videos/completed.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      } as any,
    ];

    setQueueJobs(jobs);

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      delete_transcode_jobs_bulk: (payload) => {
        // 模拟后端在返回 false 的同时，实际上已经把任务从队列中删除的极端情况。
        const ids = (payload?.jobIds ?? payload?.job_ids) as string[];
        const deletable = new Set(ids ?? []);
        setQueueJobs(getQueueJobs().filter((job) => !deletable.has(job.id)));
        return false;
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

    setSelectedJobIds(vm, ["job-completed"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    const error = vm.queueError ?? vm.queueError?.value ?? null;
    const failedMessage = i18n.global.t("queue.error.deleteFailed");

    // 任务已经不在队列快照中时，不应该提示“部分任务删除失败”。
    expect(error).not.toBe(failedMessage);

    wrapper.unmount();
  });

  it("cancel-and-delete cancels active jobs then deletes them after cooperative cancellation completes", async () => {
    const jobs: TranscodeJob[] = [
      {
        id: "job-completed",
        filename: "C:/videos/completed.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "completed",
        progress: 100,
        logs: [],
      } as any,
      {
        id: "job-processing",
        filename: "C:/videos/processing.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 20,
        originalCodec: "h264",
        presetId: "p1",
        status: "processing",
        progress: 10,
        logs: [],
      } as any,
    ];

    setQueueJobs(jobs);

    const cancelledIds: string[] = [];
    const deletedIds: string[] = [];

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      cancel_transcode_jobs_bulk: (payload) => {
        const ids = (payload?.jobIds ?? payload?.job_ids) as string[];
        cancelledIds.push(...(ids ?? []));
        // First notify: cancellation requested but job may still be processing.
        emitQueueState(getQueueJobs());
        // Second notify: cooperative cancellation completes and the job becomes terminal.
        setTimeout(() => {
          const idSet = new Set(ids ?? []);
          setQueueJobs(
            getQueueJobs().map((job) =>
              idSet.has(job.id) ? ({ ...job, status: "cancelled", progress: 0 } as any) : job,
            ),
          );
          emitQueueState(getQueueJobs());
        }, 0);
        return true;
      },
      delete_transcode_jobs_bulk: (payload) => {
        const ids = (payload?.jobIds ?? payload?.job_ids) as string[];
        deletedIds.push(...(ids ?? []));
        const deletable = new Set(ids ?? []);
        setQueueJobs(getQueueJobs().filter((job) => !deletable.has(job.id)));
        emitQueueState(getQueueJobs());
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

    setSelectedJobIds(vm, ["job-completed", "job-processing"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    const confirmOpen = vm.queueDeleteConfirmOpen ?? vm.queueDeleteConfirmOpen?.value;
    expect(confirmOpen).toBe(true);

    const label = i18n.global.t("queue.dialogs.deleteMixed.cancelAndDelete") as string;
    const buttons = Array.from(document.body.querySelectorAll("button"));
    const cancelAndDeleteButton = buttons.find((btn) => (btn.textContent ?? "").trim() === label);
    expect(cancelAndDeleteButton, `expected a button labeled "${label}"`).toBeTruthy();

    cancelAndDeleteButton!.click();
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "cancel_transcode_jobs_bulk")).toBe(true);
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_jobs_bulk")).toBe(true);

    const cancelCall = invokeMock.mock.calls.find(([cmd]) => cmd === "cancel_transcode_jobs_bulk");
    const cancelPayload = cancelCall?.[1] as any;
    expect(cancelPayload?.jobIds).toEqual(["job-processing"]);
    expect(cancelPayload?.job_ids).toEqual(["job-processing"]);

    const deleteCall = invokeMock.mock.calls.find(([cmd]) => cmd === "delete_transcode_jobs_bulk");
    const deletePayload = deleteCall?.[1] as any;
    expect(deletePayload?.jobIds).toEqual(["job-completed", "job-processing"]);
    expect(deletePayload?.job_ids).toEqual(["job-completed", "job-processing"]);

    expect(cancelledIds).toEqual(["job-processing"]);
    expect(new Set(deletedIds)).toEqual(new Set(["job-completed", "job-processing"]));

    wrapper.unmount();
  });
});
