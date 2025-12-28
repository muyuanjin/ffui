// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { i18n, useBackendMock, setQueueJobs, getQueueJobs, defaultAppSettings } from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp global alerts", () => {
  it("does not surface a global error when delete requires confirmation", async () => {
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
    await nextTick();

    if (typeof vm.bulkDelete === "function") {
      await vm.bulkDelete();
    }
    await nextTick();

    const queueError = (vm.queueError ?? vm.queueError?.value) as string | null | undefined;
    expect(queueError == null).toBe(true);

    expect(wrapper.find("[data-testid='global-alerts']").exists()).toBe(false);

    const confirmOpen = vm.queueDeleteConfirmOpen ?? vm.queueDeleteConfirmOpen?.value;
    expect(confirmOpen).toBe(true);

    wrapper.unmount();
  });
});
