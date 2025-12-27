// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { useVirtuaViewportBump } from "@/components/panels/queue/useVirtuaViewportBump";

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(_el: Element) {
    void this.callback;
  }
  disconnect() {}
}

function createEl(height: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      height,
      width: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: 0,
      x: 0,
      y: 0,
      toJSON() {},
    }) as any;
  return el;
}

describe("useVirtuaViewportBump", () => {
  const originalResizeObserver = (globalThis as any).ResizeObserver;
  const originalRaf = window.requestAnimationFrame;

  beforeEach(() => {
    (globalThis as any).ResizeObserver = ResizeObserverMock;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as any;
  });

  afterEach(() => {
    (globalThis as any).ResizeObserver = originalResizeObserver;
    window.requestAnimationFrame = originalRaf;
    vi.restoreAllMocks();
  });

  it("bumps once when a measurable viewport element appears after mount", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const viewportEl = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
          const bump = useVirtuaViewportBump(viewportEl, { minHeightPx: 64 });
          const setViewport = (el: HTMLElement | null) => {
            viewportEl.value = el;
          };
          return { bump, setViewport };
        },
        template: "<div />",
      }),
    );

    expect((wrapper.vm as any).bump).toBe(0);
    (wrapper.vm as any).setViewport(createEl(120));
    await nextTick();
    expect((wrapper.vm as any).bump).toBe(1);
  });

  it("does not bump when the viewport stays below the threshold", async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const viewportEl = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>;
          const bump = useVirtuaViewportBump(viewportEl, { minHeightPx: 64 });
          const setViewport = (el: HTMLElement | null) => {
            viewportEl.value = el;
          };
          return { bump, setViewport };
        },
        template: "<div />",
      }),
    );

    (wrapper.vm as any).setViewport(createEl(10));
    await nextTick();
    expect((wrapper.vm as any).bump).toBe(0);
  });
});
