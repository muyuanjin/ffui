<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CompareMediaStage from "./CompareMediaStage.vue";
export type CompareMode = "side-by-side" | "wipe" | "blink";
const props = defineProps<{
  open: boolean;
  mode: CompareMode;
  loadingSources: boolean;
  sourcesError: string | null;
  usingFrameCompare: boolean;
  inputVideoUrl: string | null;
  outputVideoUrl: string | null;
  inputFrameUrl: string | null;
  inputFrameLoading: boolean;
  inputFrameError: string | null;
  inputFrameQuality?: "low" | "high" | null;
  outputFrameUrl: string | null;
  outputFrameLoading: boolean;
  outputFrameError: string | null;
  outputFrameQuality?: "low" | "high" | null;
}>();
const emit = defineEmits<{
  frameImgError: [side: "input" | "output"];
  nativeError: [];
}>();
const { t } = useI18n();
const wipePercent = ref(50);
const blinkShowInput = ref(false);
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);

const isPanning = ref(false);
const isSelectingRect = ref(false);
const clickCandidate = ref(false);
const pointerId = ref<number | null>(null);
const startX = ref(0);
const startY = ref(0);
const lastX = ref(0);
const lastY = ref(0);

const rectX = ref(0);
const rectY = ref(0);
const rectW = ref(0);
const rectH = ref(0);

const viewportEl = ref<HTMLElement | null>(null);

const resetZoom = () => {
  scale.value = 1;
  translateX.value = 0;
  translateY.value = 0;
};

defineExpose({
  resetZoom,
  getContainerEl: () => viewportEl.value,
});

const transformStyle = computed(() => {
  const s = Number.isFinite(scale.value) ? scale.value : 1;
  const x = Number.isFinite(translateX.value) ? translateX.value : 0;
  const y = Number.isFinite(translateY.value) ? translateY.value : 0;
  return {
    transform: `translate(${x}px, ${y}px) scale(${s})`,
    transformOrigin: "0 0",
  } as const;
});

const blinkSideLabel = computed(() => {
  return blinkShowInput.value ? (t("jobCompare.sides.input") as string) : (t("jobCompare.sides.output") as string);
});

const showCornerSideLabels = computed(() => {
  if (props.loadingSources) return false;
  if (props.sourcesError) return false;
  return props.mode === "side-by-side" || props.mode === "wipe";
});

const setScaleAt = (nextScale: number, anchorX: number, anchorY: number) => {
  const oldScale = scale.value;
  const clamped = clamp(nextScale, 1, 12);
  if (clamped === oldScale) return;

  const tx = translateX.value;
  const ty = translateY.value;

  const nextTx = anchorX - ((anchorX - tx) / oldScale) * clamped;
  const nextTy = anchorY - ((anchorY - ty) / oldScale) * clamped;

  scale.value = clamped;
  translateX.value = nextTx;
  translateY.value = nextTy;
};

const handleWheel = (event: WheelEvent) => {
  const el = viewportEl.value;
  if (!el) return;
  if (!props.open) return;
  event.preventDefault();

  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const delta = Math.sign(event.deltaY);
  const factor = delta > 0 ? 1 / 1.12 : 1.12;
  setScaleAt(scale.value * factor, x, y);
};

const beginPan = (event: PointerEvent) => {
  if (scale.value <= 1) return;
  isPanning.value = true;
  clickCandidate.value = false;
  pointerId.value = event.pointerId;
  startX.value = event.clientX;
  startY.value = event.clientY;
  lastX.value = event.clientX;
  lastY.value = event.clientY;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
};

const beginRect = (event: PointerEvent) => {
  isSelectingRect.value = true;
  clickCandidate.value = false;
  pointerId.value = event.pointerId;
  startX.value = event.clientX;
  startY.value = event.clientY;
  lastX.value = event.clientX;
  lastY.value = event.clientY;
  rectX.value = 0;
  rectY.value = 0;
  rectW.value = 0;
  rectH.value = 0;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
};

const handlePointerDown = (event: PointerEvent) => {
  if (!props.open) return;
  if (event.button === 2) {
    event.preventDefault();
    beginPan(event);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  if (event.shiftKey) {
    beginRect(event);
    return;
  }

  if (props.mode === "blink") {
    clickCandidate.value = true;
    pointerId.value = event.pointerId;
    startX.value = event.clientX;
    startY.value = event.clientY;
    lastX.value = event.clientX;
    lastY.value = event.clientY;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    return;
  }

  beginPan(event);
};

const handlePointerMove = (event: PointerEvent) => {
  if (pointerId.value == null || event.pointerId !== pointerId.value) return;

  if (clickCandidate.value && props.mode === "blink" && scale.value > 1) {
    const dx = Math.abs(event.clientX - startX.value);
    const dy = Math.abs(event.clientY - startY.value);
    if (dx >= 4 || dy >= 4) {
      clickCandidate.value = false;
      isPanning.value = true;
    }
  } else if (clickCandidate.value) {
    const dx = Math.abs(event.clientX - startX.value);
    const dy = Math.abs(event.clientY - startY.value);
    if (dx >= 4 || dy >= 4) {
      clickCandidate.value = false;
    }
  }

  if (isPanning.value) {
    const dx = event.clientX - lastX.value;
    const dy = event.clientY - lastY.value;
    translateX.value += dx;
    translateY.value += dy;
    lastX.value = event.clientX;
    lastY.value = event.clientY;
    return;
  }

  if (!isSelectingRect.value) return;
  const el = viewportEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x0 = clamp(startX.value - rect.left, 0, rect.width);
  const y0 = clamp(startY.value - rect.top, 0, rect.height);
  const x1 = clamp(event.clientX - rect.left, 0, rect.width);
  const y1 = clamp(event.clientY - rect.top, 0, rect.height);

  rectX.value = Math.min(x0, x1);
  rectY.value = Math.min(y0, y1);
  rectW.value = Math.abs(x1 - x0);
  rectH.value = Math.abs(y1 - y0);
};

const finishRectZoom = () => {
  const el = viewportEl.value;
  if (!el) return;

  const w = rectW.value;
  const h = rectH.value;
  if (w < 8 || h < 8) return;

  const rect = el.getBoundingClientRect();
  const viewportW = rect.width;
  const viewportH = rect.height;

  const factor = Math.min(viewportW / w, viewportH / h);
  const nextScale = clamp(scale.value * factor, 1, 12);

  const cx = rectX.value + w / 2;
  const cy = rectY.value + h / 2;

  const contentCx = (cx - translateX.value) / scale.value;
  const contentCy = (cy - translateY.value) / scale.value;

  const nextTx = viewportW / 2 - contentCx * nextScale;
  const nextTy = viewportH / 2 - contentCy * nextScale;

  scale.value = nextScale;
  translateX.value = nextTx;
  translateY.value = nextTy;
};

const handlePointerUp = (event: PointerEvent) => {
  if (pointerId.value == null || event.pointerId !== pointerId.value) return;

  const dx = Math.abs(event.clientX - startX.value);
  const dy = Math.abs(event.clientY - startY.value);
  const isClick = dx < 4 && dy < 4;

  if (isSelectingRect.value) {
    if (!isClick) {
      finishRectZoom();
    }
  }

  if (clickCandidate.value && isClick && props.mode === "blink") {
    blinkShowInput.value = !blinkShowInput.value;
  }

  isSelectingRect.value = false;
  isPanning.value = false;
  clickCandidate.value = false;
  pointerId.value = null;
  rectW.value = 0;
  rectH.value = 0;
};

const clearInteractionState = () => {
  isSelectingRect.value = false;
  isPanning.value = false;
  clickCandidate.value = false;
  pointerId.value = null;
  rectW.value = 0;
  rectH.value = 0;
};

watch(
  () => props.open,
  (open, prev) => {
    if (prev && !open) {
      clearInteractionState();
    }
  },
);

onBeforeUnmount(() => {
  clearInteractionState();
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
</script>

<template>
  <div
    ref="viewportEl"
    class="relative w-full h-[56vh] rounded-md bg-black overflow-hidden"
    data-testid="job-compare-viewport"
    @wheel.prevent="handleWheel"
    @dragstart.prevent
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
    @contextmenu.prevent
  >
    <div
      v-if="loadingSources"
      class="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground"
      data-testid="job-compare-loading"
    >
      {{ t("jobCompare.loading") }}
    </div>

    <div
      v-else-if="sourcesError"
      class="absolute inset-0 flex items-center justify-center text-[11px] text-destructive bg-destructive/10"
      data-testid="job-compare-error"
    >
      {{ sourcesError }}
    </div>

    <template v-else>
      <CompareMediaStage
        :mode="mode"
        :using-frame-compare="usingFrameCompare"
        :input-video-url="inputVideoUrl"
        :output-video-url="outputVideoUrl"
        :input-frame-url="inputFrameUrl"
        :input-frame-loading="inputFrameLoading"
        :input-frame-error="inputFrameError"
        :input-frame-quality="inputFrameQuality"
        :output-frame-url="outputFrameUrl"
        :output-frame-loading="outputFrameLoading"
        :output-frame-error="outputFrameError"
        :output-frame-quality="outputFrameQuality"
        :transform-style="transformStyle"
        :wipe-percent="wipePercent"
        :blink-show-input="blinkShowInput"
        @frame-img-error="(side) => emit('frameImgError', side)"
        @native-error="emit('nativeError')"
        @update:wipe-percent="(v) => (wipePercent = v)"
      />
    </template>

    <div
      v-if="showCornerSideLabels"
      class="absolute top-2 left-2 right-2 flex items-start justify-between gap-2 pointer-events-none"
      data-testid="job-compare-corner-side-labels"
    >
      <div
        class="rounded-md bg-black/60 border border-white/15 px-2 py-1.5 text-[10px] text-white select-none"
        data-testid="job-compare-corner-side-label-input"
      >
        {{ t("jobCompare.sides.input") }}
      </div>
      <div
        class="rounded-md bg-black/60 border border-white/15 px-2 py-1.5 text-[10px] text-white select-none"
        data-testid="job-compare-corner-side-label-output"
      >
        {{ t("jobCompare.sides.output") }}
      </div>
    </div>

    <div
      v-if="!loadingSources && !sourcesError && mode === 'blink'"
      class="absolute top-2 left-2 rounded-md bg-black/60 border border-white/15 px-2 py-1.5 text-[10px] text-white select-none"
      data-testid="job-compare-blink-indicator"
    >
      <div class="font-semibold">{{ blinkSideLabel }}</div>
      <div class="text-[10px] text-white/70">{{ t("jobCompare.blinkHint") }}</div>
    </div>

    <div
      v-if="isSelectingRect && rectW > 0 && rectH > 0"
      class="absolute border border-primary bg-primary/10 pointer-events-none"
      :style="{ left: `${rectX}px`, top: `${rectY}px`, width: `${rectW}px`, height: `${rectH}px` }"
      data-testid="job-compare-rect"
    />
  </div>
</template>
