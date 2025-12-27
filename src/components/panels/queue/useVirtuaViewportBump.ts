import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";

export function useVirtuaViewportBump(viewportEl: Ref<HTMLElement | null>, options?: { minHeightPx?: number }) {
  const bump = ref(0);
  const minHeightPx = Math.max(1, options?.minHeightPx ?? 64);
  const maxBumps = 2;
  const secondBumpWindowMs = 5_000;
  let observer: ResizeObserver | null = null;
  let probeTimer: number | null = null;
  let probeStartedAtMs: number | null = null;
  let firstBumpAtMs: number | null = null;
  let lastBumpedHeightPx: number | null = null;

  const clearProbe = () => {
    if (probeTimer == null) return;
    if (typeof window === "undefined") return;
    window.clearTimeout(probeTimer);
    probeTimer = null;
    probeStartedAtMs = null;
  };

  const disconnect = () => {
    observer?.disconnect();
    observer = null;
    clearProbe();
  };

  const bumpForHeight = (height: number) => {
    if (height < minHeightPx) return;
    if (bump.value >= maxBumps) return;

    const now = Date.now();
    if (bump.value === 0) {
      bump.value = 1;
      firstBumpAtMs = now;
      lastBumpedHeightPx = height;
      return;
    }

    // Some layouts settle in multiple steps (e.g. toolbars/filters mount after the list),
    // and Virtua's viewport measurement may stick to the first "small but non-zero" size.
    // Allow one extra remount when the container height materially changes shortly after.
    const withinWindow = firstBumpAtMs != null && now - firstBumpAtMs <= secondBumpWindowMs;
    const heightJumped = lastBumpedHeightPx != null && Math.abs(height - lastBumpedHeightPx) >= minHeightPx;

    if (withinWindow && heightJumped) {
      bump.value = 2;
      lastBumpedHeightPx = height;
      disconnect();
    }
  };

  const scheduleProbe = (el: HTMLElement) => {
    if (typeof window === "undefined") return;
    if (bump.value >= maxBumps) return;
    if (probeTimer != null) return;

    const PROBE_INTERVAL_MS = 50;
    const PROBE_MAX_MS = 3_000;
    if (probeStartedAtMs == null) probeStartedAtMs = Date.now();

    const tick = () => {
      probeTimer = null;
      if (bump.value >= maxBumps) return;
      const height = el.getBoundingClientRect().height;
      bumpForHeight(height);
      if (bump.value >= maxBumps) return;
      const elapsed = Date.now() - (probeStartedAtMs ?? Date.now());
      if (elapsed >= PROBE_MAX_MS) return;
      probeTimer = window.setTimeout(tick, PROBE_INTERVAL_MS);
    };

    probeTimer = window.setTimeout(tick, 0);
  };

  const ensure = (el: HTMLElement | null) => {
    disconnect();
    if (!el) return;
    if (typeof window === "undefined") return;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const height = entries[0]?.contentRect?.height ?? 0;
        bumpForHeight(height);
      });
      observer.observe(el);
    }

    if (bump.value < maxBumps && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (bump.value >= maxBumps) return;
          bumpForHeight(el.getBoundingClientRect().height);
          scheduleProbe(el);
        });
      });
    } else {
      scheduleProbe(el);
    }
  };

  onMounted(() => {
    ensure(viewportEl.value);
  });

  watch(
    viewportEl,
    (el) => {
      ensure(el);
    },
    { flush: "post" },
  );

  onUnmounted(() => {
    disconnect();
  });

  return bump;
}
