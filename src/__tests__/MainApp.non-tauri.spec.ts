// @vitest-environment jsdom
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

describe("MainApp non-Tauri manual job flow (web preview)", () => {
  it("keeps jobs unchanged when addManualJob is called in pure web mode", async () => {
    // Explicitly ensure we are in non-Tauri mode.
    delete (window as any).__TAURI__;
    delete (window as any).__TAURI_IPC__;

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

    // Trigger the manual job flow. In pure web mode MainApp is expected to
    // behave as a no-op (queue is managed only by the backend in Tauri).
    await vm.addManualJob();
    await nextTick();

    const updatedJobsRef = vm.jobs;
    const newLength: number = Array.isArray(updatedJobsRef)
      ? updatedJobsRef.length
      : updatedJobsRef?.value?.length ?? 0;

    expect(newLength).toBe(initialLength);

    wrapper.unmount();
  });
});
