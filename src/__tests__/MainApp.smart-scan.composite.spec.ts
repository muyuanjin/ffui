import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import MainApp from "@/MainApp.vue";
import en from "@/locales/en";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

function getArray(possibleRef: any): any[] {
  if (Array.isArray(possibleRef)) return possibleRef;
  if (possibleRef && Array.isArray(possibleRef.value)) return possibleRef.value;
  return [];
}

describe("MainApp Smart Scan composite batches (non-Tauri)", () => {
  it("renders composite Smart Scan cards with expandable children and wires child inspect", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          // Use a lightweight stub for QueueItem so we can easily detect child clicks.
          QueueItem: {
            props: ["job", "preset", "canCancel"],
            template:
              '<div data-testid="queue-item-stub" @click="$emit(\'inspect\', job)"></div>',
          },
        },
      },
    });

    const vm: any = wrapper.vm;

    const presets = getArray(vm.presets);
    const presetId = presets[0]?.id ?? "p1";

    const config = {
      minImageSizeKB: 10,
      minVideoSizeMB: 10,
      minSavingRatio: 0.8,
      imageTargetFormat: "avif" as const,
      videoPresetId: presetId,
    };

    // runSmartScan uses the mock implementation in non-Tauri environments.
    vm.runSmartScan(config);
    await nextTick();
    await nextTick();

    const batchCards = wrapper.findAll('[data-testid="smart-scan-batch-card"]');
    expect(batchCards.length).toBeGreaterThan(0);

    const firstCard = batchCards[0];

    // Expand the batch card via the toggle button.
    const toggleButton = firstCard.get("button");
    await toggleButton.trigger("click");
    await nextTick();

    const childrenContainer = firstCard.find(
      '[data-testid="smart-scan-batch-children"]',
    );
    expect(childrenContainer.exists()).toBe(true);

    const childItems = childrenContainer.findAll('[data-testid="queue-item-stub"]');
    expect(childItems.length).toBeGreaterThan(0);

    await childItems[0].trigger("click");
    await nextTick();

    const selectedRef = vm.selectedJobForDetail;
    const selected =
      selectedRef && "value" in selectedRef ? selectedRef.value : selectedRef;

    expect(selected).toBeTruthy();
    expect(selected.source).toBe("smart_scan");
    expect(selected.batchId, "Smart Scan child jobs should carry a batchId").toBeTruthy();
  });
});

