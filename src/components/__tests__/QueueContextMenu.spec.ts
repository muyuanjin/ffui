// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
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

    expect(waitButton.attributes("aria-disabled")).toBeUndefined();
    expect(resumeButton.attributes("aria-disabled")).toBe("true");
  });

  it("allows restart for non-terminal jobs in both queue and display modes", async () => {
    const commonProps = {
      visible: true,
      x: 0,
      y: 0,
      mode: "single" as const,
      jobStatus: "failed" as const,
      hasSelection: true,
    };

    const inQueueMode = mount(QueueContextMenu, {
      props: {
        ...commonProps,
        queueMode: "queue",
      },
      global: { plugins: [i18n] },
    });
    const inDisplayMode = mount(QueueContextMenu, {
      props: {
        ...commonProps,
        queueMode: "display",
      },
      global: { plugins: [i18n] },
    });

    const restartInQueue = inQueueMode.get("[data-testid='queue-context-menu-restart']");
    const restartInDisplay = inDisplayMode.get("[data-testid='queue-context-menu-restart']");

    expect(restartInQueue.attributes("aria-disabled")).toBeUndefined();
    expect(restartInDisplay.attributes("aria-disabled")).toBeUndefined();
  });

  it("disables file actions when reveal paths are unavailable", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        mode: "single",
        jobStatus: "completed",
        queueMode: "queue",
        hasSelection: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const openInput = wrapper.get("[data-testid='queue-context-menu-open-input']");
    const openOutput = wrapper.get("[data-testid='queue-context-menu-open-output']");

    expect(openInput.attributes("aria-disabled")).toBe("true");
    expect(openOutput.attributes("aria-disabled")).toBe("true");
  });

  it("emits file reveal events when enabled", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        mode: "single",
        jobStatus: "completed",
        queueMode: "queue",
        hasSelection: true,
        canRevealInputPath: true,
        canRevealOutputPath: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.get("[data-testid='queue-context-menu-open-input']").trigger("click");
    await wrapper.get("[data-testid='queue-context-menu-open-output']").trigger("click");

    expect(wrapper.emitted("open-input-folder")).toBeTruthy();
    expect(wrapper.emitted("open-output-folder")).toBeTruthy();
    expect(wrapper.emitted("close")).toBeTruthy();
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

    expect(bulkCancel.attributes("aria-disabled")).toBe("true");
    expect(bulkWait.attributes("aria-disabled")).toBe("true");
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

  it("clamps menu position to keep it inside the viewport", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });

    try {
      const wrapper = mount(QueueContextMenu, {
        props: {
          visible: true,
          x: 190,
          y: 190,
          mode: "single",
          jobStatus: "processing",
          queueMode: "queue",
          hasSelection: true,
        },
        global: {
          plugins: [i18n],
        },
      });

      const menuEl = wrapper.get("[data-testid='queue-context-menu']").element as HTMLElement;
      vi.spyOn(menuEl, "getBoundingClientRect").mockReturnValue({
        width: 120,
        height: 120,
        top: 0,
        left: 0,
        right: 120,
        bottom: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      // Trigger a second clamp pass after the spy is installed.
      await wrapper.setProps({ x: 189, y: 189 });

      await nextTick();
      await nextTick();

      const anchorEl = wrapper.get("[data-testid='queue-context-menu-anchor']").element as HTMLElement;
      expect(anchorEl.style.left).toBe("72px");
      expect(anchorEl.style.top).toBe("72px");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("renders lucide icons for menu items", async () => {
    const wrapper = mount(QueueContextMenu, {
      props: {
        visible: true,
        x: 0,
        y: 0,
        mode: "single",
        jobStatus: "processing",
        queueMode: "queue",
        hasSelection: true,
        canRevealInputPath: true,
        canRevealOutputPath: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const menu = wrapper.get("[data-testid='queue-context-menu']");
    const inspectItem = menu.get("[role='menuitem']");
    expect(inspectItem.find("svg").exists()).toBe(true);

    const waitButton = wrapper.get("[data-testid='queue-context-menu-wait']");
    expect(waitButton.find("svg").exists()).toBe(true);

    const openInput = wrapper.get("[data-testid='queue-context-menu-open-input']");
    expect(openInput.find("svg").exists()).toBe(true);
  });

  it("teleports the fixed overlay container to body when requested", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    try {
      const wrapper = mount(QueueContextMenu, {
        attachTo: host,
        props: {
          visible: true,
          x: 100,
          y: 100,
          mode: "single",
          jobStatus: "processing",
          queueMode: "queue",
          hasSelection: true,
          teleportToBody: true,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();
      await nextTick();

      const root = document.body.querySelector("[data-testid='queue-context-menu-root']") as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.className).toContain("z-[60]");
      wrapper.unmount();
    } finally {
      host.remove();
      document.body.querySelector("[data-testid='queue-context-menu-root']")?.remove();
    }
  });
});
