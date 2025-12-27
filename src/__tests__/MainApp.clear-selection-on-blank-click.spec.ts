// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import { i18n, useBackendMock, setQueueJobs, getQueueJobs, defaultAppSettings } from "./helpers/mainAppTauriDialog";
import { setSelectedJobIds } from "./helpers/queueSelection";
import type { TranscodeJob } from "@/types";

describe("MainApp clears queue selection on blank click", () => {
  const mountQueueWithOneSelectedJob = async () => {
    const { default: MainApp } = await import("@/MainApp.vue");

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/sample.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
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

    setSelectedJobIds(vm, ["job-1"]);
    await nextTick();

    const selectedBefore = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selectedBefore?.size ?? 0).toBe(1);

    return { wrapper, vm };
  };

  it("clears selectedJobIds when clicking a non-interactive blank area", async () => {
    const { wrapper, vm } = await mountQueueWithOneSelectedJob();

    await wrapper.get("[data-testid='ffui-app-root']").trigger("pointerdown");
    await nextTick();

    const selectedAfter = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selectedAfter?.size ?? 0).toBe(0);

    wrapper.unmount();
  }, 15_000);

  it("clears selection when clicking titlebar blank area", async () => {
    const { wrapper, vm } = await mountQueueWithOneSelectedJob();

    await wrapper.get("[data-testid='ffui-titlebar']").trigger("pointerdown");
    await nextTick();

    const selectedAfter = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selectedAfter?.size ?? 0).toBe(0);

    wrapper.unmount();
  }, 15_000);

  it("clears selection when clicking sidebar blank area", async () => {
    const { wrapper, vm } = await mountQueueWithOneSelectedJob();

    await wrapper.get("[data-testid='ffui-sidebar']").trigger("pointerdown");
    await nextTick();

    const selectedAfter = vm.selectedJobIds instanceof Set ? vm.selectedJobIds : vm.selectedJobIds?.value;
    expect(selectedAfter?.size ?? 0).toBe(0);

    wrapper.unmount();
  }, 15_000);
});
