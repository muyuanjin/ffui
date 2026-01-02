<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useElementSize } from "@vueuse/core";
import type { FFmpegPreset, PresetCardFooterItemKey, PresetCardFooterSettings } from "@/types";
import { getPresetAvgFps, getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import { toFixedDisplay } from "@/lib/numberDisplay";
import { getRatioColorClass } from "../presetHelpers";
import PresetCardFooterVmafStat from "./PresetCardFooterVmafStat.vue";
import { normalizePresetCardFooterSettings } from "./presetCardFooterSettings";

const props = defineProps<{
  preset: FFmpegPreset;
  predictedVmaf?: number | null;
  footerSettings?: PresetCardFooterSettings | null;
}>();

const { t } = useI18n();
const effectiveFooterSettings = computed<Required<PresetCardFooterSettings>>(() => {
  return normalizePresetCardFooterSettings(props.footerSettings);
});

const footerEnabledCount = computed(() => {
  const s = effectiveFooterSettings.value;
  return (
    (s.showAvgSize ? 1 : 0) +
    (s.showFps ? 1 : 0) +
    (s.showVmaf ? 1 : 0) +
    (s.showUsedCount ? 1 : 0) +
    (s.showDataAmount ? 1 : 0) +
    (s.showThroughput ? 1 : 0)
  );
});

const oneRowAbbrevLabels = computed(() => {
  return effectiveFooterSettings.value.layout === "oneRow" && footerEnabledCount.value > 3;
});

const footerLabelAvgSize = computed(() =>
  oneRowAbbrevLabels.value
    ? (t("presets.footerLabels.avgSizeShort") as string)
    : (t("presets.footerLabels.avgSizeFull") as string),
);
const footerLabelUsedCount = computed(() =>
  oneRowAbbrevLabels.value
    ? (t("presets.footerLabels.usedCountShort") as string)
    : (t("presets.footerLabels.usedCountFull") as string),
);
const footerLabelDataAmount = computed(() =>
  oneRowAbbrevLabels.value
    ? (t("presets.footerLabels.dataAmountShort") as string)
    : (t("presets.footerLabels.dataAmountFull") as string),
);
const footerLabelThroughput = computed(() =>
  oneRowAbbrevLabels.value
    ? (t("presets.footerLabels.throughputShort") as string)
    : (t("presets.footerLabels.throughputFull") as string),
);

const inputGbText = computed(() => (props.preset.stats.totalInputSizeMB / 1024).toFixed(1));
const avgRatioValue = computed(() => getPresetAvgRatio(props.preset));
const avgRatioDisplayValue = computed<number | null>(() => {
  const v = avgRatioValue.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return toFixedDisplay(v, 0)?.value ?? null;
});
const avgRatioText = computed(() => (avgRatioDisplayValue.value == null ? "—" : String(avgRatioDisplayValue.value)));
const avgSpeedText = computed(() => getPresetAvgSpeed(props.preset)?.toFixed(1) ?? "—");
const avgFpsText = computed(() => getPresetAvgFps(props.preset)?.toFixed(0) ?? "—");

const predictedVmafText = computed(() => {
  const v = props.predictedVmaf;
  return toFixedDisplay(v, 2)?.text ?? "—";
});

const measuredVmaf = computed(() => {
  const stats = props.preset.stats;
  const c = Number(stats.vmafCount ?? 0);
  const sum = Number(stats.vmafSum ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!Number.isFinite(sum)) return null;
  return sum / c;
});

const measuredVmafText = computed(() => {
  const v = measuredVmaf.value;
  if (v == null || !Number.isFinite(v)) return null;
  return toFixedDisplay(v, 2)?.text ?? null;
});

const measuredVmafCount = computed(() => {
  const c = Number(props.preset.stats.vmafCount ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  return Math.floor(c);
});

const vmafDisplayValue = computed<number | null>(() => {
  const measured = measuredVmaf.value;
  if (typeof measured === "number" && Number.isFinite(measured)) {
    return toFixedDisplay(measured, 2)?.value ?? null;
  }
  const predicted = props.predictedVmaf;
  if (typeof predicted === "number" && Number.isFinite(predicted)) {
    return toFixedDisplay(predicted, 2)?.value ?? null;
  }
  return null;
});

const vmaf95Plus = computed(() => {
  const v = vmafDisplayValue.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 95;
});

const vmafTitle = computed(() => {
  const parts: string[] = [];
  const mean = measuredVmafText.value;
  if (mean) {
    const c = measuredVmafCount.value;
    parts.push(
      c
        ? (t("presets.vmafTooltipMeasuredWithCount", { value: mean, count: c }) as string)
        : (t("presets.vmafTooltipMeasured", { value: mean }) as string),
    );
  } else if (predictedVmafText.value !== "—") {
    parts.push(t("presets.vmafTooltipPredicted", { value: predictedVmafText.value }) as string);
  }
  if (vmaf95Plus.value) parts.push(t("presets.vmafHint95") as string);
  return parts.join(" · ") || "VMAF";
});

const vmafStatProps = computed(() => ({
  show: effectiveFooterSettings.value.showVmaf,
  title: vmafTitle.value,
  vmaf95Plus: vmaf95Plus.value,
  predictedVmafText: predictedVmafText.value,
  measuredVmafText: measuredVmafText.value,
  measuredVmafCount: measuredVmafCount.value,
}));

const avgRatioTitle = computed(() => t("presets.avgRatio", { percent: avgRatioText.value }) as string);
const avgFpsTitle = computed(() => t("presets.avgFps", { fps: avgFpsText.value }) as string);
const ratioColorClass = computed(() => getRatioColorClass(avgRatioDisplayValue.value));

const isShown = (k: PresetCardFooterItemKey): boolean => {
  const s = effectiveFooterSettings.value;
  switch (k) {
    case "avgSize":
      return s.showAvgSize;
    case "fps":
      return s.showFps;
    case "vmaf":
      return s.showVmaf;
    case "usedCount":
      return s.showUsedCount;
    case "dataAmount":
      return s.showDataAmount;
    case "throughput":
      return s.showThroughput;
  }
  return false;
};

const visibleKeysOrdered = computed(() => effectiveFooterSettings.value.order.filter((k) => isShown(k)));

const twoRowsBreakAfterIndex = computed<number | null>(() => {
  if (effectiveFooterSettings.value.layout !== "twoRows") return null;
  const n = visibleKeysOrdered.value.length;
  if (n <= 3) return null;
  return Math.ceil(n / 2);
});

const shouldShowSeparatorBeforeIndex = (idx: number): boolean => {
  if (idx <= 0) return false;
  const breakIdx = twoRowsBreakAfterIndex.value;
  return !(effectiveFooterSettings.value.layout === "twoRows" && breakIdx != null && idx === breakIdx);
};

const separatorProbe = computed(() => shouldShowSeparatorBeforeIndex(1));

const footerOuterRef = ref<HTMLElement | null>(null);
const footerInnerRef = ref<HTMLElement | null>(null);
const { width: footerWidth } = useElementSize(footerOuterRef);

const FOOTER_FONT_MAX_PX = 14;
const FOOTER_FONT_MIN_PX = 9;
const FOOTER_GAP_MAX_PX = 8;
const FOOTER_GAP_MIN_PX = 3;
const footerFontPx = ref<number>(FOOTER_FONT_MAX_PX);
const footerGapPx = ref<number>(FOOTER_GAP_MAX_PX);
const oneRowWrapFallback = ref(false);

const recalcFooterFont = async () => {
  if (effectiveFooterSettings.value.layout !== "oneRow") return;
  if (footerEnabledCount.value <= 0) return;
  oneRowWrapFallback.value = false;
  await nextTick();
  const outer = footerOuterRef.value;
  const inner = footerInnerRef.value;
  if (!outer || !inner) return;

  const available = Math.max(0, Math.floor(outer.clientWidth));
  if (available <= 0) return;
  const availableSafe = Math.max(0, available - 2);

  // Start from the largest readable size, then shrink until it fits.
  let font = FOOTER_FONT_MAX_PX;
  let gap = FOOTER_GAP_MAX_PX;
  footerFontPx.value = font;
  footerGapPx.value = gap;
  await nextTick();

  const maxIterations = 32;
  for (let i = 0; i < maxIterations; i++) {
    const needed = Math.max(0, Math.ceil(inner.scrollWidth));
    if (needed <= availableSafe) break;

    if (gap > FOOTER_GAP_MIN_PX) {
      gap = Math.max(FOOTER_GAP_MIN_PX, gap - 1);
      footerGapPx.value = gap;
      await nextTick();
      continue;
    }

    if (font <= FOOTER_FONT_MIN_PX) break;
    font = Math.max(FOOTER_FONT_MIN_PX, Math.round((font - 0.5) * 10) / 10);
    footerFontPx.value = font;
    await nextTick();
  }

  const neededAfterShrink = Math.max(0, Math.ceil(inner.scrollWidth));
  if (neededAfterShrink > availableSafe) {
    oneRowWrapFallback.value = true;
    footerFontPx.value = 12;
    footerGapPx.value = 6;
    return;
  }

  // If there's room, grow back towards max (so it doesn't look tiny).
  for (let i = 0; i < maxIterations; i++) {
    const needed = Math.max(0, Math.ceil(inner.scrollWidth));
    if (needed > availableSafe) break;
    if (font >= FOOTER_FONT_MAX_PX && gap >= FOOTER_GAP_MAX_PX) break;

    if (font < FOOTER_FONT_MAX_PX) {
      const next = Math.min(FOOTER_FONT_MAX_PX, Math.round((font + 0.5) * 10) / 10);
      footerFontPx.value = next;
      await nextTick();
      const neededNext = Math.max(0, Math.ceil(inner.scrollWidth));
      if (neededNext <= availableSafe) {
        font = next;
        continue;
      }
      footerFontPx.value = font;
      await nextTick();
    }

    if (gap < FOOTER_GAP_MAX_PX) {
      const next = Math.min(FOOTER_GAP_MAX_PX, gap + 1);
      footerGapPx.value = next;
      await nextTick();
      const neededNext = Math.max(0, Math.ceil(inner.scrollWidth));
      if (neededNext <= availableSafe) {
        gap = next;
        continue;
      }
      footerGapPx.value = gap;
      await nextTick();
    }
    break;
  }
};

watch(footerWidth, recalcFooterFont);
watch(
  [
    () => effectiveFooterSettings.value.layout,
    () => effectiveFooterSettings.value.order.join(","),
    () => effectiveFooterSettings.value.showAvgSize,
    () => effectiveFooterSettings.value.showFps,
    () => effectiveFooterSettings.value.showVmaf,
    () => effectiveFooterSettings.value.showUsedCount,
    () => effectiveFooterSettings.value.showDataAmount,
    () => effectiveFooterSettings.value.showThroughput,
    footerLabelAvgSize,
    footerLabelUsedCount,
    footerLabelDataAmount,
    footerLabelThroughput,
    () => props.preset.stats.usageCount,
    inputGbText,
    avgRatioText,
    avgSpeedText,
    avgFpsText,
    avgRatioTitle,
    avgFpsTitle,
    ratioColorClass,
    predictedVmafText,
    measuredVmafText,
    measuredVmafCount,
    vmafStatProps,
    separatorProbe,
  ],
  recalcFooterFont,
);

onMounted(() => {
  requestAnimationFrame(() => {
    void recalcFooterFont();
  });
});
</script>

<template>
  <div
    v-if="footerEnabledCount > 0"
    class="text-muted-foreground pt-1.5 pb-1 border-t border-border/30 mt-auto"
    data-testid="preset-card-footer-stats"
  >
    <div
      ref="footerOuterRef"
      :class="effectiveFooterSettings.layout === 'oneRow' ? 'w-full' : '[container-type:inline-size]'"
    >
      <div
        ref="footerInnerRef"
        :class="
          effectiveFooterSettings.layout === 'oneRow'
            ? oneRowWrapFallback
              ? 'flex flex-wrap items-center justify-center tabular-nums leading-none'
              : 'inline-flex items-center justify-center whitespace-nowrap tabular-nums leading-none'
            : 'flex flex-wrap items-center justify-center tabular-nums leading-none tracking-tight text-[clamp(12px,2.6cqw,14px)] gap-x-[clamp(8px,2cqw,12px)] gap-y-1'
        "
        data-testid="preset-card-footer-items"
        :style="
          effectiveFooterSettings.layout === 'oneRow'
            ? { fontSize: `${footerFontPx}px`, gap: `${footerGapPx}px` }
            : undefined
        "
      >
        <template v-for="(k, idx) in visibleKeysOrdered" :key="k">
          <span
            v-if="
              effectiveFooterSettings.layout === 'twoRows' &&
              twoRowsBreakAfterIndex != null &&
              idx === twoRowsBreakAfterIndex
            "
            class="basis-full h-0"
            aria-hidden="true"
            data-testid="preset-card-footer-break"
          />

          <span
            v-if="k === 'avgSize'"
            class="flex flex-wrap items-center max-w-full"
            :title="avgRatioTitle"
            data-footer-item="avgSize"
          >
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <span v-if="footerLabelAvgSize" class="text-muted-foreground">{{ footerLabelAvgSize }}</span>
            <span class="ml-1 inline-flex items-baseline gap-1">
              <span :class="ratioColorClass">{{ avgRatioText }}</span>
              <span class="text-muted-foreground">%</span>
            </span>
          </span>

          <span
            v-else-if="k === 'fps'"
            class="flex flex-wrap items-center max-w-full"
            :title="avgFpsTitle"
            data-footer-item="fps"
          >
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <span class="text-muted-foreground">{{ t("presets.footerLabels.fps") }}</span>
            <span class="ml-1 text-foreground">{{ avgFpsText }}</span>
          </span>

          <span v-else-if="k === 'vmaf'" class="flex flex-wrap items-center max-w-full" data-footer-item="vmaf">
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <PresetCardFooterVmafStat v-bind="vmafStatProps" />
          </span>

          <span
            v-else-if="k === 'usedCount'"
            class="flex flex-wrap items-center max-w-full"
            :title="t('presets.usedTimes', { count: preset.stats.usageCount })"
            data-footer-item="usedCount"
          >
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <span v-if="footerLabelUsedCount" class="text-muted-foreground">{{ footerLabelUsedCount }}</span>
            <span class="ml-1 inline-flex items-baseline gap-1">
              <span class="text-foreground">{{ preset.stats.usageCount }}</span>
              <span class="text-muted-foreground">{{ t("presets.usageCountUnit") }}</span>
            </span>
          </span>

          <span
            v-else-if="k === 'dataAmount'"
            class="flex flex-wrap items-center max-w-full"
            :title="t('presets.totalIn', { gb: inputGbText })"
            data-footer-item="dataAmount"
          >
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <span v-if="footerLabelDataAmount" class="text-muted-foreground">{{ footerLabelDataAmount }}</span>
            <span class="ml-1 inline-flex items-baseline gap-1">
              <span class="text-foreground">{{ inputGbText }}</span>
              <span class="text-muted-foreground">G</span>
            </span>
          </span>

          <span
            v-else-if="k === 'throughput'"
            class="flex flex-wrap items-center max-w-full"
            :title="t('presets.avgSpeed', { mbps: avgSpeedText })"
            data-footer-item="throughput"
          >
            <span
              v-if="shouldShowSeparatorBeforeIndex(idx)"
              aria-hidden="true"
              class="mx-1.5 inline-block h-[0.9em] w-px shrink-0 bg-border/60"
              data-testid="preset-card-footer-separator"
            />
            <span v-if="footerLabelThroughput" class="text-muted-foreground">{{ footerLabelThroughput }}</span>
            <span class="ml-1 inline-flex items-baseline gap-1">
              <span class="text-foreground">{{ avgSpeedText }}</span>
              <span class="text-muted-foreground">MB/s</span>
            </span>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>
