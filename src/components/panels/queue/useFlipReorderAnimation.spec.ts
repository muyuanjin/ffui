// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, defineComponent, nextTick, ref } from "vue";
import { useFlipReorderAnimation } from "./useFlipReorderAnimation";

const makeRect = (top: number, left = 0) => {
  const height = 40;
  const width = 100;
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRectReadOnly;
};

const stubRectByDomOrder = (el: HTMLElement) => {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const parent = el.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      const index = Math.max(0, siblings.indexOf(el));
      return makeRect(index * 100);
    },
  });
};

describe("useFlipReorderAnimation", () => {
  const originalAnimate = HTMLElement.prototype.animate;
  const originalGetAnimations = (HTMLElement.prototype as any).getAnimations;
  const originalRaf = window.requestAnimationFrame;

  afterEach(() => {
    HTMLElement.prototype.animate = originalAnimate;
    (HTMLElement.prototype as any).getAnimations = originalGetAnimations;
    window.requestAnimationFrame = originalRaf;
  });

  it("runs FLIP animation when keyed items reorder", async () => {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as any;

    const calls: Array<{ key?: string; frames: any[] }> = [];
    const animateSpy = vi.fn(function (this: HTMLElement, frames: any) {
      calls.push({ key: this.dataset.queueFlipKey, frames });
      return { cancel: vi.fn() } as any;
    });
    HTMLElement.prototype.animate = animateSpy as any;

    const wrapper = mount(
      defineComponent({
        setup() {
          const containerEl = ref<HTMLElement | null>(null);
          const keys = ref<string[]>(["a", "b"]);

          useFlipReorderAnimation(
            containerEl,
            computed(() => keys.value),
            {
              durationMs: 120,
              prefersReducedMotion: () => false,
            },
          );

          return { containerEl, keys };
        },
        template: `
          <div ref="containerEl">
            <div v-for="k in keys" :key="k" class="item" :data-queue-flip-key="k" />
          </div>
        `,
      }),
    );

    await nextTick();
    for (const el of wrapper.findAll<HTMLElement>(".item").map((w) => w.element)) {
      stubRectByDomOrder(el);
    }

    (wrapper.vm as any).keys = ["b", "a"];
    await nextTick();

    expect(calls.map((c) => c.key).sort()).toEqual(["a", "b"]);
    expect(calls.find((c) => c.key === "a")?.frames?.[0]?.transform).toContain("-100px");
    expect(calls.find((c) => c.key === "b")?.frames?.[0]?.transform).toContain("100px");
  });

  it("cancels previous FLIP animations without touching descendant animations", async () => {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as any;

    const getAnimationsSpy = vi.fn(() => []);
    (HTMLElement.prototype as any).getAnimations = getAnimationsSpy;

    const cancelByKey = new Map<string, ReturnType<typeof vi.fn>>();
    const animateSpy = vi.fn(function (this: HTMLElement) {
      const cancel = vi.fn();
      if (this.dataset.queueFlipKey) {
        cancelByKey.set(this.dataset.queueFlipKey, cancel);
      }
      return { cancel } as any;
    });
    HTMLElement.prototype.animate = animateSpy as any;

    const wrapper = mount(
      defineComponent({
        setup() {
          const containerEl = ref<HTMLElement | null>(null);
          const keys = ref<string[]>(["a", "b"]);

          useFlipReorderAnimation(
            containerEl,
            computed(() => keys.value),
            {
              durationMs: 120,
              prefersReducedMotion: () => false,
            },
          );

          return { containerEl, keys };
        },
        template: `
          <div ref="containerEl">
            <div v-for="k in keys" :key="k" class="item" :data-queue-flip-key="k" />
          </div>
        `,
      }),
    );

    await nextTick();
    for (const el of wrapper.findAll<HTMLElement>(".item").map((w) => w.element)) {
      stubRectByDomOrder(el);
    }

    (wrapper.vm as any).keys = ["b", "a"];
    await nextTick();

    const cancelA = cancelByKey.get("a");
    const cancelB = cancelByKey.get("b");
    expect(cancelA).toBeDefined();
    expect(cancelB).toBeDefined();

    (wrapper.vm as any).keys = ["a", "b"];
    await nextTick();

    expect(cancelA).toHaveBeenCalled();
    expect(cancelB).toHaveBeenCalled();
    expect(getAnimationsSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the order is unchanged", async () => {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as any;

    const animateSpy = vi.fn(function (this: HTMLElement, ..._args: any[]) {
      return { cancel: vi.fn() } as any;
    });
    HTMLElement.prototype.animate = animateSpy as any;

    const wrapper = mount(
      defineComponent({
        setup() {
          const containerEl = ref<HTMLElement | null>(null);
          const keys = ref<string[]>(["a", "b"]);

          useFlipReorderAnimation(
            containerEl,
            computed(() => keys.value),
            {
              durationMs: 120,
              prefersReducedMotion: () => false,
            },
          );

          return { containerEl, keys };
        },
        template: `
          <div ref="containerEl">
            <div v-for="k in keys" :key="k" class="item" :data-queue-flip-key="k" />
          </div>
        `,
      }),
    );

    await nextTick();
    for (const el of wrapper.findAll<HTMLElement>(".item").map((w) => w.element)) {
      stubRectByDomOrder(el);
    }

    (wrapper.vm as any).keys = ["a", "b"];
    await nextTick();

    expect(animateSpy).not.toHaveBeenCalled();
  });
});
