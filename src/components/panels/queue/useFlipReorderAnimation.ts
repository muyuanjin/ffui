import { onUpdated, watch, type Ref } from "vue";

type Rect = Pick<DOMRectReadOnly, "left" | "top">;

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
  let prevRects: Map<string, Rect> | null = null;

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

  watch(
    containerEl,
    () => {
      pending = false;
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
    if (!enabled()) return;
    if (prefersReducedMotion()) return;
    if (!prevRects || prevRects.size === 0) return;
    if (durationMs <= 0) return;

    const { elements, rects: nextRects } = readRects();
    if (nextRects.size === 0) return;

    for (const [key, nextRect] of nextRects) {
      const prevRect = prevRects.get(key);
      if (!prevRect) continue;

      const dx = prevRect.left - nextRect.left;
      const dy = prevRect.top - nextRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      const el = elements.get(key);
      if (!el) continue;

      if (typeof el.getAnimations === "function") {
        for (const anim of el.getAnimations()) {
          anim.cancel();
        }
      }

      if (typeof el.animate === "function") {
        el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "translate3d(0, 0, 0)" }], {
          duration: durationMs,
          easing,
        });
        continue;
      }

      if (typeof window === "undefined") continue;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void Promise.resolve().then(() => {
        el.style.transition = `transform ${durationMs}ms ${easing}`;
        el.style.transform = "translate3d(0, 0, 0)";
        setTimeout(() => {
          el.style.transition = "";
          el.style.transform = "";
        }, durationMs + 50);
      });
    }

    prevRects = null;
  });
}
