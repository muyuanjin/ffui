// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { i18n, useBackendMock, setQueueJobs, getQueueJobs, defaultAppSettings } from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import type { TranscodeJob } from "@/types";

describe("MainApp global alerts", () => {
  it("surfaces queue deletion warnings under the header (outside the scroll area)", async () => {
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

    const expected = (i18n as any).global.t("queue.error.deleteActiveNotAllowed") as string;
    const queueError = (vm.queueError ?? vm.queueError?.value) as string | null;
    expect(queueError).toBe(expected);

    const globalAlerts = wrapper.get("[data-testid='global-alerts']");
    expect(globalAlerts.text()).toContain(expected);

    // The global alert bar must not render inside the scrollable queue panel.
    expect(wrapper.find("[data-testid='queue-panel'] [data-testid='global-alerts']").exists()).toBe(false);

    // Dismissing the alert clears the error state.
    await globalAlerts.get("button[aria-label='Dismiss queue alert']").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-testid='global-alerts']").exists()).toBe(false);

    wrapper.unmount();
  });
});
