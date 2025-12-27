import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";

export function useVirtuaViewportBump(viewportEl: Ref<HTMLElement | null>, options?: { minHeightPx?: number }) {
  const bump = ref(0);
  const minHeightPx = Math.max(1, options?.minHeightPx ?? 64);
  let observer: ResizeObserver | null = null;

  const disconnect = () => {
    observer?.disconnect();
    observer = null;
  };

  const ensure = (el: HTMLElement | null) => {
    disconnect();
    if (!el) return;
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return;

    observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect?.height ?? 0;
      if (bump.value === 0 && height >= minHeightPx) bump.value = 1;
    });
    observer.observe(el);

    if (bump.value === 0 && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (bump.value !== 0) return;
          if (el.getBoundingClientRect().height >= minHeightPx) bump.value = 1;
        });
      });
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
