// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputPolicy } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainContentHeader output container badge + hover preview", () => {
  it("renders container badge left of output settings and shows a compact preview", () => {
    const DialogStub = defineComponent({
      name: "Dialog",
      props: { open: { type: Boolean, default: false } },
      template: `<div v-if="open"><slot /></div>`,
    });

    const policy: OutputPolicy = {
      container: { mode: "force", format: "mkv" },
      directory: { mode: "fixed", directory: "D:/Outputs" },
      filename: { prefix: "P-", suffix: ".compressed", appendTimestamp: true, randomSuffixLen: 6 },
      preserveFileTimes: { created: true, modified: true, accessed: false },
    };

    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: "p1",
        presets: [{ id: "p1", name: "Universal 1080p" } as any],
        queueViewModeModel: "detail",
        presetSortMode: "manual",
        queueOutputPolicy: policy,
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: `<div><slot /></div>` },
          HoverCardTrigger: { template: `<div><slot /></div>` },
          HoverCardContent: { template: `<div><slot /></div>` },
          Dialog: DialogStub,
          DialogContent: { template: `<div><slot /></div>` },
          DialogHeader: { template: `<div><slot /></div>` },
          DialogTitle: { template: `<div><slot /></div>` },
          OutputPolicyEditor: { template: `<div />` },
          Select: { template: `<div><slot /></div>` },
          SelectContent: { template: `<div><slot /></div>` },
          SelectItem: { template: `<div><slot /></div>` },
          SelectTrigger: { template: `<div><slot /></div>` },
          SelectValue: { template: `<div><slot /></div>` },
        },
      },
    });

    const badge = wrapper.get("[data-testid='ffui-queue-output-container-badge']");
    expect(badge.text()).toBe("mkv");

    const preview = wrapper.get("[data-testid='ffui-queue-output-settings-hover-preview']");
    expect(preview.text()).toContain("Preview");
    expect(preview.text()).toContain("Output Container");
    expect(preview.text()).toContain("mkv");
    expect(preview.text()).toContain("Force format");
    expect(preview.text()).toContain("Fixed directory");
    expect(preview.text()).toContain("D:/Outputs");
  });
});

