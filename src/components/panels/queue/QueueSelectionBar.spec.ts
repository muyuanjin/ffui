// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import QueueSelectionBar from "./QueueSelectionBar.vue";
import en from "@/locales/en";

const resizeObservers: Array<{ trigger: () => void }> = [];
class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push({ trigger: () => this.callback([], this as any) });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("QueueSelectionBar responsive affordances", () => {
  it("renders compact+full selection count and keeps icon buttons accessible", async () => {
    (globalThis as any).ResizeObserver = MockResizeObserver;
    resizeObservers.length = 0;

    const wrapper = mount(QueueSelectionBar, {
      props: {
        selectionBarPinned: false,
        selectedCount: 3,
        queueMode: "queue",
      },
      global: { plugins: [i18n] },
    });

    const root = wrapper.get(".queue-selection-bar");
    expect(root.attributes("data-density")).toBe("full");

    const viewport = wrapper.get(".queue-selection-bar__viewport");
    expect(viewport.classes()).toContain("overflow-x-hidden");

    const row = wrapper.get(".queue-selection-bar__viewport .queue-selection-bar__row");
    expect(row.classes()).toContain("min-w-max");

    const count = wrapper.get("[data-testid='queue-selection-count']");
    expect(count.text()).toContain("Selected 3 job(s)");

    const selection = (en as any).queue.selection as Record<string, string>;
    const actions = (en as any).queue.actions as Record<string, string>;

    const selectAll = wrapper.get(`button[aria-label="${selection.selectAll}"]`);
    expect(selectAll.attributes("title")).toBe(selection.selectAll);
    expect(selectAll.text()).toBe(selection.selectAll);

    const invert = wrapper.get(`button[aria-label="${selection.invert}"]`);
    expect(invert.attributes("title")).toBe(selection.invert);
    expect(invert.text()).toBe(selection.invert);

    const clear = wrapper.get(`button[aria-label="${selection.clear}"]`);
    expect(clear.attributes("title")).toBe(selection.clear);
    expect(clear.text()).toBe(selection.clear);

    const bulkWait = wrapper.get(`button[aria-label="${actions.bulkWait}"]`);
    expect(bulkWait.attributes("title")).toBe(actions.bulkWait);
    expect(bulkWait.text()).toBe(actions.bulkWait);

    const bulkResume = wrapper.get(`button[aria-label="${actions.bulkResume}"]`);
    expect(bulkResume.attributes("title")).toBe(actions.bulkResume);
    expect(bulkResume.text()).toBe(actions.bulkResume);

    const bulkCancel = wrapper.get(`button[aria-label="${actions.bulkCancel}"]`);
    expect(bulkCancel.attributes("title")).toBe(actions.bulkCancel);
    expect(bulkCancel.text()).toBe(actions.bulkCancel);

    const fullSizerRow = wrapper.get(".queue-selection-bar__sizer-row--full");
    const shortSizerRow = wrapper.get(".queue-selection-bar__sizer-row--short");

    Object.defineProperty(viewport.element, "clientWidth", { value: 500, configurable: true });
    Object.defineProperty(fullSizerRow.element, "scrollWidth", { value: 400, configurable: true });
    Object.defineProperty(shortSizerRow.element, "scrollWidth", { value: 300, configurable: true });
    resizeObservers.forEach((o) => o.trigger());
    await nextTick();
    expect(root.attributes("data-density")).toBe("full");
    expect(count.text()).toContain("Selected 3 job(s)");

    Object.defineProperty(viewport.element, "clientWidth", { value: 350, configurable: true });
    resizeObservers.forEach((o) => o.trigger());
    await nextTick();
    expect(root.attributes("data-density")).toBe("short");
    expect(count.text()).toBe("3 selected");
    expect(selectAll.text()).toBe("");
    expect(bulkCancel.text()).toBe("");
    expect(bulkWait.text()).toBe(actions.bulkWaitShort);
    expect(bulkResume.text()).toBe(actions.bulkResumeShort);

    Object.defineProperty(viewport.element, "clientWidth", { value: 250, configurable: true });
    resizeObservers.forEach((o) => o.trigger());
    await nextTick();
    expect(root.attributes("data-density")).toBe("icon");
    expect(viewport.classes()).toContain("overflow-x-auto");
    expect(count.text()).toBe("3");
    expect(selectAll.text()).toBe("");
    expect(bulkCancel.text()).toBe("");
  });
});
