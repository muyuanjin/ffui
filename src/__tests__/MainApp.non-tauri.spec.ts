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

describe("MainApp non-Tauri manual job flow", () => {
  it("adds a mock job when addManualJob is called in non-Tauri mode", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    const jobsRef = vm.jobs;
    const initialLength: number = Array.isArray(jobsRef)
      ? jobsRef.length
      : jobsRef?.value?.length ?? 0;

    // Trigger the manual job flow. In jsdom there is no __TAURI__ global,
    // so hasTauri() returns false and MainApp uses the mock queue path.
    vm.addManualJob();
    await nextTick();

    const updatedJobsRef = vm.jobs;
    const newLength: number = Array.isArray(updatedJobsRef)
      ? updatedJobsRef.length
      : updatedJobsRef?.value?.length ?? 0;

    expect(newLength).toBeGreaterThan(initialLength);
  });
});
