import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

describe("MainApp non-Tauri cancel flow", () => {
  it("handleCancelJob marks simulated jobs as cancelled with a log entry", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    // In non-Tauri mode, addManualJob uses the mock queue path.
    vm.addManualJob();
    await nextTick();

    const jobsBefore = getArray(vm.jobs);
    expect(jobsBefore.length).toBeGreaterThan(0);

    const jobId = jobsBefore[0].id;

    await vm.handleCancelJob(jobId);
    await nextTick();

    const jobsAfter = getArray(vm.jobs);
    const jobAfter = jobsAfter.find((j: any) => j.id === jobId);
    expect(jobAfter).toBeTruthy();
    expect(jobAfter.status).toBe("cancelled");
    const hasSimulatedLog = jobAfter.logs.some((log: string) =>
      log.includes("Cancelled in simulated mode"),
    );
    expect(hasSimulatedLog).toBe(true);
  });
});
