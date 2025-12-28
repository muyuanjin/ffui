// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";

import { useBodyPointerEventsFailsafe } from "@/composables/main-app/useBodyPointerEventsFailsafe";

describe("useBodyPointerEventsFailsafe", () => {
  it("restores body pointer-events when no overlays are open", async () => {
    vi.useFakeTimers();
    const original = document.body.style.pointerEvents;
    document.body.style.pointerEvents = "";

    const hasBlockingOverlay = ref(true);
    const App = defineComponent({
      setup() {
        useBodyPointerEventsFailsafe({ hasBlockingOverlay, intervalMs: 50 });
        return () => h("div");
      },
    });

    const wrapper = mount(App, { attachTo: document.body });

    document.body.style.pointerEvents = "none";
    hasBlockingOverlay.value = false;
    await wrapper.vm.$nextTick();

    vi.runOnlyPendingTimers();
    expect(document.body.style.pointerEvents).toBe("");

    wrapper.unmount();
    document.body.style.pointerEvents = original;
    vi.useRealTimers();
  });

  it("does not override pointer-events while overlays are open", async () => {
    vi.useFakeTimers();
    const original = document.body.style.pointerEvents;
    document.body.style.pointerEvents = "";

    const hasBlockingOverlay = ref(true);
    const App = defineComponent({
      setup() {
        useBodyPointerEventsFailsafe({ hasBlockingOverlay, intervalMs: 50 });
        return () => h("div");
      },
    });

    const wrapper = mount(App, { attachTo: document.body });

    document.body.style.pointerEvents = "none";
    await wrapper.vm.$nextTick();

    vi.advanceTimersByTime(200);
    expect(document.body.style.pointerEvents).toBe("none");

    wrapper.unmount();
    document.body.style.pointerEvents = original;
    vi.useRealTimers();
  });
});
