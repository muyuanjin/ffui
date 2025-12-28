import { onScopeDispose, ref, watch, type Ref } from "vue";

export function useScrollActivitySignal(targetEl: Ref<HTMLElement | null>, options?: { idleMs?: number }) {
  // Be conservative: treat short gaps between wheel/scroll bursts as "still scrolling"
  // so expensive work doesn't start during inertial scrolling.
  const idleMs = Math.max(80, Math.floor(options?.idleMs ?? 220));
  const isScrolling = ref(false);

  let clearHandle: number | null = null;
  const clear = () => {
    if (typeof window === "undefined") return;
    if (clearHandle == null) return;
    window.clearTimeout(clearHandle);
    clearHandle = null;
  };

  const bump = () => {
    isScrolling.value = true;
    if (typeof window === "undefined") return;
    clear();
    clearHandle = window.setTimeout(() => {
      clearHandle = null;
      isScrolling.value = false;
    }, idleMs);
  };

  const addListeners = (el: HTMLElement) => {
    // Capture scroll activity without preventing default scrolling.
    // `scroll` won't fire for wheel-only deltas in some cases, so listen to both.
    // `scroll` does not bubble, so use capture to observe nested scrollers.
    el.addEventListener("scroll", bump, { passive: true, capture: true });
    el.addEventListener("wheel", bump, { passive: true, capture: true });
    el.addEventListener("touchmove", bump, { passive: true, capture: true });
  };

  const removeListeners = (el: HTMLElement) => {
    el.removeEventListener("scroll", bump, true);
    el.removeEventListener("wheel", bump, true);
    el.removeEventListener("touchmove", bump, true);
  };

  watch(
    targetEl,
    (next, prev) => {
      if (prev) removeListeners(prev);
      if (next) addListeners(next);
    },
    { immediate: true, flush: "post" },
  );

  onScopeDispose(() => {
    clear();
    const el = targetEl.value;
    if (el) removeListeners(el);
  });

  return { isScrolling };
}
