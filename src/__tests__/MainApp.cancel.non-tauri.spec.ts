// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

describe("MainApp non-Tauri cancel flow (web preview)", () => {
  it("handleCancelJob is a no-op for simulated jobs when Tauri is unavailable", async () => {
    delete (window as any).__TAURI__;
    delete (window as any).__TAURI_IPC__;

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = withMainAppVmCompat(wrapper);

    // Seed a fake job directly into the reactive jobs ref.
    const jobsBefore = [
      {
        id: "job-sim-1",
        filename: "simulated.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "queued",
        progress: 0,
        logs: [] as string[],
      },
    ];

    if (Array.isArray(vm.jobs)) {
      vm.jobs = jobsBefore;
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = jobsBefore;
    }

    await nextTick();

    await vm.handleCancelJob("job-sim-1");
    await nextTick();

    const jobsAfter = getArray(vm.jobs);
    const jobAfter = jobsAfter.find((j: any) => j.id === "job-sim-1");
    expect(jobAfter).toBeTruthy();
    // In pure web mode the cancel handler is expected to be a no-op; the
    // queue is only driven by the backend in real Tauri builds.
    expect(jobAfter.status).toBe("queued");
    expect(jobAfter.logs).toEqual([]);

    wrapper.unmount();
  });
});
