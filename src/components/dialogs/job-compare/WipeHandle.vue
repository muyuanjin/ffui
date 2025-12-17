<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  modelValue: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();

const rootEl = ref<HTMLElement | null>(null);
const activePointerId = ref<number | null>(null);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const setFromClientX = (clientX: number) => {
  const el = rootEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  const x = clamp(clientX - rect.left, 0, rect.width);
  emit("update:modelValue", (x / rect.width) * 100);
};

const onPointerDown = (event: PointerEvent) => {
  activePointerId.value = event.pointerId;
  setFromClientX(event.clientX);
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (activePointerId.value == null || event.pointerId !== activePointerId.value) return;
  setFromClientX(event.clientX);
};

const onPointerUp = (event: PointerEvent) => {
  if (activePointerId.value == null || event.pointerId !== activePointerId.value) return;
  activePointerId.value = null;
};
</script>

<template>
  <div
    ref="rootEl"
    class="absolute inset-0 pointer-events-none"
    data-testid="job-compare-wipe-handle"
  >
    <div
      class="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize z-20"
      :style="{ left: `${props.modelValue}%`, transform: 'translateX(-50%)' }"
      @pointerdown.stop.prevent="onPointerDown"
      @pointermove.stop.prevent="onPointerMove"
      @pointerup.stop.prevent="onPointerUp"
      @pointercancel.stop.prevent="onPointerUp"
    >
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/60 border border-white/30 px-1.5 py-1 text-[10px] text-white select-none"
      >
        ⇆
      </div>
    </div>
  </div>
</template>
