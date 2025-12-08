// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueContextMenu from "@/components/main/QueueContextMenu.vue";
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

describe("QueueContextMenu", () => {
  it("enables single-job actions based on job status and queue mode", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 100,
        y: 200,
        mode: "single",
        jobStatus: "processing",
        queueMode: "display",
        hasSelection: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const waitButton = wrapper.get("[data-testid='queue-context-menu-wait']");
    const resumeButton = wrapper.get("[data-testid='queue-context-menu-resume']");

    expect(waitButton.attributes("disabled")).toBeUndefined();
    expect(resumeButton.attributes("disabled")).toBeDefined();
  });

  it("disables bulk actions when nothing is selected", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        mode: "bulk",
        queueMode: "queue",
        hasSelection: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    const bulkCancel = wrapper.get("[data-testid='queue-context-menu-bulk-cancel']");
    const bulkWait = wrapper.get("[data-testid='queue-context-menu-bulk-wait']");

    expect(bulkCancel.attributes("disabled")).toBeDefined();
    expect(bulkWait.attributes("disabled")).toBeDefined();
  });

  it("emits corresponding events when menu items are clicked", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        mode: "single",
        jobStatus: "processing",
        queueMode: "queue",
        hasSelection: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const waitButton = wrapper.get("[data-testid='queue-context-menu-wait']");
    await waitButton.trigger("click");

    expect(wrapper.emitted("wait")).toBeTruthy();
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
