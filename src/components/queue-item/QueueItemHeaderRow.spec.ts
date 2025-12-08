// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueItemHeaderRow from "./QueueItemHeaderRow.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any, "zh-CN": zhCN as any },
});

const baseJob = {
  id: "job-1",
  filename: "C:/v.mp4",
  type: "video",
  source: "manual",
  originalSizeMB: 10,
  originalCodec: "h264",
  presetId: "p1",
  status: "processing",
  progress: 10,
  logs: [],
};

const preset = { id: "p1", name: "Preset" } as any;

describe("QueueItemHeaderRow tooltips", () => {
  it("shows title tooltips for action buttons", () => {
    const wrapper = mount(QueueItemHeaderRow, {
      props: {
        job: baseJob as any,
        preset,
        isSelectable: false,
        isSelected: false,
        isSkipped: false,
        typeLabel: "VIDEO",
        displayFilename: "v.mp4",
        displayOriginalSize: "10",
        displayOutputSize: "",
        savedLabel: "",
        sourceLabel: "Manual",
        statusTextClass: "",
        localizedStatus: "processing",
        isWaitable: true,
        isResumable: false,
        isRestartable: true,
        isCancellable: true,
        previewUrl: null,
        t: (k: string) => k,
      },
      global: { plugins: [i18n] },
    });

    const detail = wrapper.get('[data-testid="queue-item-detail-button"]');
    const wait = wrapper.get('[data-testid="queue-item-wait-button"]');
    const restart = wrapper.get('[data-testid="queue-item-restart-button"]');

    expect(detail.attributes("title")).toBeDefined();
    expect(wait.attributes("title")).toBeDefined();
    expect(restart.attributes("title")).toBeDefined();
  });
});

