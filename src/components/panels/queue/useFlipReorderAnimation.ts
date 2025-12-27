import { onUpdated, watch, type Ref } from "vue";

type Rect = Pick<DOMRectReadOnly, "left" | "top">;

type FlipHandle = {
  cancel: () => void;
};

const defaultPrefersReducedMotion = (): boolean => {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const isSameOrder = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export function useFlipReorderAnimation(
  containerEl: Ref<HTMLElement | null>,
  orderedKeys: Ref<readonly string[]>,
  options?: {
    enabled?: () => boolean;
    durationMs?: number;
    easing?: string;
    selector?: string;
    prefersReducedMotion?: () => boolean;
  },
) {
  const enabled = options?.enabled ?? (() => true);
  const durationMs = Math.max(0, options?.durationMs ?? 220);
  const easing = options?.easing ?? "cubic-bezier(0.2, 0.8, 0.2, 1)";
  const selector = options?.selector ?? "[data-queue-flip-key]";
  const prefersReducedMotion = options?.prefersReducedMotion ?? defaultPrefersReducedMotion;

  let pending = false;
  let scheduled = false;
  let rafId: number | null = null;
  let prevRects: Map<string, Rect> | null = null;
  const handles = new WeakMap<HTMLElement, FlipHandle>();

  const readRects = (): { elements: Map<string, HTMLElement>; rects: Map<string, Rect> } => {
    const root = containerEl.value;
    const elements = new Map<string, HTMLElement>();
    const rects = new Map<string, Rect>();
    if (!root) return { elements, rects };
    const list = root.querySelectorAll<HTMLElement>(selector);
    for (const el of list) {
      const key = el.dataset.queueFlipKey;
      if (!key) continue;
      elements.set(key, el);
      const r = el.getBoundingClientRect();
      rects.set(key, { left: r.left, top: r.top });
    }
    return { elements, rects };
  };

  const cancelScheduled = () => {
    if (rafId == null) return;
    if (typeof window === "undefined") return;
    if (typeof window.cancelAnimationFrame !== "function") return;
    window.cancelAnimationFrame(rafId);
    rafId = null;
  };

  const cancelHandle = (el: HTMLElement) => {
    const handle = handles.get(el);
    if (!handle) return;
    handle.cancel();
    handles.delete(el);
  };

  const scheduleRun = (run: () => void) => {
    if (scheduled) return;
    scheduled = true;

    const invoke = () => {
      scheduled = false;
      rafId = null;
      run();
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      rafId = window.requestAnimationFrame(() => invoke());
      return;
    }

    void Promise.resolve().then(() => invoke());
  };

  watch(
    containerEl,
    () => {
      pending = false;
      scheduled = false;
      cancelScheduled();
      prevRects = null;
    },
    { flush: "sync" },
  );

  watch(
    orderedKeys,
    (next, prev) => {
      if (!enabled()) return;
      if (prefersReducedMotion()) return;
      if (isSameOrder(next, prev)) return;

      const { rects } = readRects();
      if (rects.size === 0) return;
      prevRects = rects;
      pending = true;
    },
    { flush: "pre" },
  );

  onUpdated(() => {
    if (!pending) return;
    pending = false;
    scheduleRun(() => {
      if (!enabled()) return;
      if (prefersReducedMotion()) return;
      if (!prevRects || prevRects.size === 0) {
        prevRects = null;
        return;
      }
      if (durationMs <= 0) {
        prevRects = null;
        return;
      }

      const { elements, rects: nextRects } = readRects();
      if (nextRects.size === 0) {
        prevRects = null;
        return;
      }

      for (const [key, nextRect] of nextRects) {
        const prevRect = prevRects.get(key);
        if (!prevRect) continue;

        const dx = prevRect.left - nextRect.left;
        const dy = prevRect.top - nextRect.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

        const el = elements.get(key);
        if (!el) continue;

        cancelHandle(el);

        if (typeof el.animate === "function") {
          const anim = el.animate(
            [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "translate3d(0, 0, 0)" }],
            {
              duration: durationMs,
              easing,
            },
          );

          const handle: FlipHandle = { cancel: () => anim.cancel() };
          handles.set(el, handle);
          const clear = () => {
            if (handles.get(el) !== handle) return;
            handles.delete(el);
          };
          if (typeof (anim as any).addEventListener === "function") {
            (anim as any).addEventListener("finish", clear);
            (anim as any).addEventListener("cancel", clear);
          } else {
            (anim as any).onfinish = clear;
            (anim as any).oncancel = clear;
          }
          continue;
        }

        if (typeof window === "undefined") continue;
        const prevTransform = el.style.transform;
        const prevTransition = el.style.transition;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        const timer = window.setTimeout(() => {
          el.style.transition = prevTransition;
          el.style.transform = prevTransform;
          if (handles.get(el)?.cancel === handle.cancel) {
            handles.delete(el);
          }
        }, durationMs + 50);

        const handle: FlipHandle = {
          cancel: () => {
            window.clearTimeout(timer);
            el.style.transition = prevTransition;
            el.style.transform = prevTransform;
          },
        };
        handles.set(el, handle);

        void Promise.resolve().then(() => {
          el.style.transition = `transform ${durationMs}ms ${easing}`;
          el.style.transform = "translate3d(0, 0, 0)";
        });
      }

      prevRects = null;
    });
  });
}
