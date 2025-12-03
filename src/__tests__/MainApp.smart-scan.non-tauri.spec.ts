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

function getLength(possibleRef: any): number {
  if (Array.isArray(possibleRef)) return possibleRef.length;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value.length;
  return 0;
}

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

describe("MainApp non-Tauri Smart Scan fallback", () => {
  it("runSmartScan populates jobs via mock when Tauri is unavailable and lastDroppedRoot is null", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const initialJobsLen = getLength(vm.jobs);

    const presets = getArray(vm.presets);
    const presetId = presets[0]?.id ?? "p1";

    const config = {
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minSavingRatio: 0.8,
      imageTargetFormat: "avif" as const,
      videoPresetId: presetId,
    };

    await vm.runSmartScan(config);
    await nextTick();

    const updatedJobsLen = getLength(vm.jobs);
    expect(updatedJobsLen).toBeGreaterThan(initialJobsLen);

    const jobsArray = getArray(vm.jobs);
    const hasSmartScanJob = jobsArray.some((job: any) => job.source === "smart_scan");
    expect(hasSmartScanJob).toBe(true);
  });
});
