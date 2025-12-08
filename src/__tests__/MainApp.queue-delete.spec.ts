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
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

function setSelectedJobIds(vm: any, ids: string[]) {
  const value = vm.selectedJobIds;
  const next = new Set(ids);
  if (value instanceof Set) {
    vm.selectedJobIds = next;
  } else if (value && "value" in value) {
    value.value = next;
  }
}

describe("MainApp queue delete behaviour", () => {
  it("does not call backend delete for non-terminal jobs and surfaces an error", async () => {
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
      delete_transcode_job: () => {
        throw new Error("delete_transcode_job should not be called for active jobs");
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
    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_job"),
    ).toBe(false);

    // An error message should be surfaced to guide the user.
    expect(vm.queueError ?? vm.queueError?.value).toBeTruthy();

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

    // Select both jobs and trigger bulk delete.
    setSelectedJobIds(vm, ["job-completed", "job-processing"]);

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    // The backend delete command should be called only for the completed job.
    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === "delete_transcode_job"),
    ).toBe(true);
    expect(deletedIds).toContain("job-completed");
    expect(deletedIds).not.toContain("job-processing");

    wrapper.unmount();
  });
});
