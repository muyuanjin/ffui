<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useElementSize } from "@vueuse/core";
import type { FFmpegPreset, PresetCardFooterItemKey, PresetCardFooterLayout, PresetCardFooterSettings } from "@/types";
import { getPresetAvgFps, getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";
import { getRatioColorClass } from "../presetHelpers";
import PresetCardFooterPrimaryStats from "./PresetCardFooterPrimaryStats.vue";

const props = defineProps<{
  preset: FFmpegPreset;
  predictedVmaf?: number | null;
  footerSettings?: PresetCardFooterSettings | null;
}>();

const { t } = useI18n();

const DEFAULT_FOOTER_SETTINGS: Required<PresetCardFooterSettings> = {
  layout: "twoRows",
  order: ["avgSize", "fps", "vmaf", "usedCount", "dataAmount", "throughput"],
  showAvgSize: true,
  showFps: true,
  showVmaf: true,
  showUsedCount: true,
  showDataAmount: true,
  showThroughput: true,
};

const effectiveFooterSettings = computed<Required<PresetCardFooterSettings>>(() => {
  const raw = props.footerSettings ?? null;
  const layout: PresetCardFooterLayout =
    raw?.layout === "oneRow" || raw?.layout === "twoRows" ? raw.layout : DEFAULT_FOOTER_SETTINGS.layout;

  const normalizeOrder = (order: PresetCardFooterItemKey[] | undefined): PresetCardFooterItemKey[] => {
    const defaults = DEFAULT_FOOTER_SETTINGS.order;
    const rawOrder = Array.isArray(order) ? order : [];
    const seen = new Set<PresetCardFooterItemKey>();
    const out: PresetCardFooterItemKey[] = [];
    for (const k of rawOrder) {
      if (!defaults.includes(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    for (const k of defaults) if (!seen.has(k)) out.push(k);
    return out;
  };

  return {
    layout,
    order: normalizeOrder(raw?.order),
    showAvgSize: raw?.showAvgSize ?? DEFAULT_FOOTER_SETTINGS.showAvgSize,
    showFps: raw?.showFps ?? DEFAULT_FOOTER_SETTINGS.showFps,
    showVmaf: raw?.showVmaf ?? DEFAULT_FOOTER_SETTINGS.showVmaf,
    showUsedCount: raw?.showUsedCount ?? DEFAULT_FOOTER_SETTINGS.showUsedCount,
    showDataAmount: raw?.showDataAmount ?? DEFAULT_FOOTER_SETTINGS.showDataAmount,
    showThroughput: raw?.showThroughput ?? DEFAULT_FOOTER_SETTINGS.showThroughput,
  };
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
const avgRatioText = computed(() => avgRatioValue.value?.toFixed(0) ?? "—");
const avgSpeedText = computed(() => getPresetAvgSpeed(props.preset)?.toFixed(1) ?? "—");
const avgFpsText = computed(() => getPresetAvgFps(props.preset)?.toFixed(0) ?? "—");

const predictedVmafText = computed(() => {
  const v = props.predictedVmaf;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
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
  return v.toFixed(1);
});

const measuredVmafCount = computed(() => {
  const c = Number(props.preset.stats.vmafCount ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  return Math.floor(c);
});

const vmaf95Plus = computed(() => {
  const measured = measuredVmaf.value;
  const predicted = props.predictedVmaf;
  const v =
    (typeof measured === "number" && Number.isFinite(measured) ? measured : null) ??
    (typeof predicted === "number" && Number.isFinite(predicted) ? predicted : null);
  return typeof v === "number" && Number.isFinite(v) && v >= 95;
});

const vmafTitle = computed(() => {
  const parts: string[] = [];
  const mean = measuredVmafText.value;
  if (mean) {
    parts.push(`meas=${mean}`);
  } else if (predictedVmafText.value !== "—") {
    parts.push(`pred=${predictedVmafText.value}`);
  }
  if (vmaf95Plus.value) parts.push(t("presets.vmafHint95"));
  return parts.join(" / ") || "VMAF";
});

const vmafStatProps = computed(() => ({
  show: effectiveFooterSettings.value.showVmaf,
  title: vmafTitle.value,
  vmaf95Plus: vmaf95Plus.value,
  predictedVmafText: predictedVmafText.value,
  measuredVmafText: measuredVmafText.value,
  measuredVmafCount: measuredVmafCount.value,
}));

const primaryStatsProps = computed(() => ({
  showAvgSize: effectiveFooterSettings.value.showAvgSize,
  showFps: effectiveFooterSettings.value.showFps,
  showVmaf: effectiveFooterSettings.value.showVmaf,
  avgSizeLabel: footerLabelAvgSize.value,
  fpsLabel: t("presets.footerLabels.fps") as string,
  avgRatioText: avgRatioText.value,
  avgRatioTitle: t("presets.avgRatio", { percent: avgRatioText.value }) as string,
  ratioColorClass: getRatioColorClass(avgRatioValue.value),
  avgFpsText: avgFpsText.value,
  avgFpsTitle: t("presets.avgFps", { fps: avgFpsText.value }) as string,
  orderAvgSize: orderStyle("avgSize"),
  orderFps: orderStyle("fps"),
  orderVmaf: orderStyle("vmaf"),
  vmafStatProps: vmafStatProps.value,
}));

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
};

const visibleKeysOrdered = computed(() => effectiveFooterSettings.value.order.filter((k) => isShown(k)));

const orderIndex = computed(() => {
  const map = new Map<PresetCardFooterItemKey, number>();
  for (const [idx, key] of visibleKeysOrdered.value.entries()) map.set(key, idx);
  return map;
});

// Use even step orders so we can insert "break" elements between items using an odd integer order.
// Note: CSS `order` is an integer; fractional values may be ignored by some engines.
const orderStyle = (k: PresetCardFooterItemKey) => ({ order: (orderIndex.value.get(k) ?? 999) * 2 });

const twoRowsBreakOrder = computed(() => {
  const n = visibleKeysOrdered.value.length;
  if (n <= 3) return null;
  const breakAfter = Math.ceil(n / 2);
  return breakAfter * 2 - 1;
});

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
    predictedVmafText,
    measuredVmafText,
    measuredVmafCount,
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
    <template v-if="effectiveFooterSettings.layout === 'oneRow'">
      <div ref="footerOuterRef" class="w-full">
        <div
          ref="footerInnerRef"
          :class="
            oneRowWrapFallback
              ? 'flex flex-wrap items-center justify-center tabular-nums leading-none'
              : 'inline-flex items-center justify-center whitespace-nowrap tabular-nums leading-none'
          "
          :style="{ fontSize: `${footerFontPx}px`, gap: `${footerGapPx}px` }"
        >
          <PresetCardFooterPrimaryStats v-bind="primaryStatsProps" />
          <span
            v-if="effectiveFooterSettings.showUsedCount"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('usedCount')"
            :title="t('presets.usedTimes', { count: preset.stats.usageCount })"
            data-footer-item="usedCount"
          >
            <span v-if="footerLabelUsedCount" class="text-muted-foreground">{{ footerLabelUsedCount }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ preset.stats.usageCount }}</span>
              <span class="text-muted-foreground">次</span>
            </span>
          </span>
          <span
            v-if="effectiveFooterSettings.showDataAmount"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('dataAmount')"
            :title="t('presets.totalIn', { gb: inputGbText })"
            data-footer-item="dataAmount"
          >
            <span v-if="footerLabelDataAmount" class="text-muted-foreground">{{ footerLabelDataAmount }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ inputGbText }}</span>
              <span class="text-muted-foreground">G</span>
            </span>
          </span>
          <span
            v-if="effectiveFooterSettings.showThroughput"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('throughput')"
            :title="t('presets.avgSpeed', { mbps: avgSpeedText })"
            data-footer-item="throughput"
          >
            <span v-if="footerLabelThroughput" class="text-muted-foreground">{{ footerLabelThroughput }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ avgSpeedText }}</span>
              <span class="text-muted-foreground">MB/s</span>
            </span>
          </span>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="[container-type:inline-size]">
        <div
          class="flex flex-wrap items-center justify-center tabular-nums leading-none tracking-tight text-[clamp(10px,1.8cqw,14px)] gap-x-[clamp(8px,2cqw,12px)] gap-y-1"
        >
          <PresetCardFooterPrimaryStats v-bind="primaryStatsProps" />

          <span
            v-if="twoRowsBreakOrder != null"
            class="basis-full h-0"
            :style="{ order: twoRowsBreakOrder }"
            aria-hidden="true"
            data-testid="preset-card-footer-break"
          />

          <span
            v-if="effectiveFooterSettings.showUsedCount"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('usedCount')"
            :title="t('presets.usedTimes', { count: preset.stats.usageCount })"
            data-footer-item="usedCount"
          >
            <span class="text-muted-foreground">{{ t("presets.footerLabels.usedCountFull") }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ preset.stats.usageCount }}</span>
              <span class="text-muted-foreground">次</span>
            </span>
          </span>
          <span
            v-if="effectiveFooterSettings.showDataAmount"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('dataAmount')"
            :title="t('presets.totalIn', { gb: inputGbText })"
            data-footer-item="dataAmount"
          >
            <span class="text-muted-foreground">{{ t("presets.footerLabels.dataAmountFull") }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ inputGbText }}</span>
              <span class="text-muted-foreground">G</span>
            </span>
          </span>
          <span
            v-if="effectiveFooterSettings.showThroughput"
            class="flex flex-wrap items-center max-w-full"
            :style="orderStyle('throughput')"
            :title="t('presets.avgSpeed', { mbps: avgSpeedText })"
            data-footer-item="throughput"
          >
            <span class="text-muted-foreground">{{ t("presets.footerLabels.throughputFull") }}</span>
            <span>
              <span class="text-foreground mx-0.5">{{ avgSpeedText }}</span>
              <span class="text-muted-foreground">MB/s</span>
            </span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
