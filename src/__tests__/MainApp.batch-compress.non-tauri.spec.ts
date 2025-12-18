// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
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

function getLength(possibleRef: any): number {
  if (Array.isArray(possibleRef)) return possibleRef.length;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value.length;
  return 0;
}

describe("MainApp non-Tauri Batch Compress behaviour (web preview)", () => {
  it("runBatchCompress is a no-op when Tauri is unavailable", async () => {
    delete (window as any).__TAURI__;
    delete (window as any).__TAURI_IPC__;

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const initialJobsLen = getLength(vm.jobs);

    const config = {
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minSavingRatio: 0.8,
      imageTargetFormat: "avif" as const,
      videoPresetId: "p1",
    };

    await vm.runBatchCompress(config);
    await nextTick();

    const updatedJobsLen = getLength(vm.jobs);
    expect(updatedJobsLen).toBe(initialJobsLen);

    wrapper.unmount();
  });
});
