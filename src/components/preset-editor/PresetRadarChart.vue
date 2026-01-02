<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import type { FFmpegPreset } from "@/types";
import type { PresetRadar } from "@/lib/presetInsights";
import type { VqPredictedMetrics } from "@/lib/vqResults/predict";
import { computeMeasuredRadarOverrides } from "@/lib/presetRadarCalibration";
import { fetchGpuUsage, hasTauri } from "@/lib/backend";
import { loadVqResultsSnapshot } from "@/lib/vqResults/client";
import { predictFromVqResults } from "@/lib/vqResults/predict";
import type { VqResultsSnapshot } from "@/lib/vqResults/types";
import {
  computePresetStatsSummary,
  computeQualityFromVq,
  formatMetricNumber,
  formatMetricRange,
  formatInputSize,
  formatMbPerSec,
  formatPercent,
} from "./presetRadarHelpers";

const props = defineProps<{
  metrics: PresetRadar;
  hasStats: boolean;
  preset?: FFmpegPreset;
  allPresets?: FFmpegPreset[];
}>();

const { t } = useI18n();

const showVqAdvancedControls = import.meta.env.DEV;

const axisKeys = ["quality", "sizeSaving", "speed", "compatibility", "popularity"] as const;

const maxValue = 5;
const centerX = 64;
const centerY = 64;
const maxRadius = 40;

const radarMetrics = computed<PresetRadar>(() => {
  const base = props.metrics;
  const merged: PresetRadar = { ...base };

  const preset = props.preset;
  const allPresets = props.allPresets ?? [];
  if (preset && allPresets.length > 0) {
    const overrides = computeMeasuredRadarOverrides(preset, allPresets);
    if (typeof overrides.speed === "number") merged.speed = overrides.speed;
    if (typeof overrides.sizeSaving === "number") merged.sizeSaving = overrides.sizeSaving;
    if (typeof overrides.popularity === "number") merged.popularity = overrides.popularity;
  }

  const predicted = vqPredicted.value;
  if (predicted) {
    const q = computeQualityFromVq(predicted);
    if (q != null) merged.quality = q;
  }

  return merged;
});

const statsSummary = computed(() => {
  const preset = props.preset;
  if (!preset || !props.hasStats) return null;
  return computePresetStatsSummary(preset);
});

const toPolygonPoints = (radar: PresetRadar): string => {
  const values = axisKeys.map((key, index) => {
    const raw = radar[key] ?? 0;
    const value = Math.max(0, Math.min(maxValue, raw));
    const angle = (Math.PI * 2 * index) / axisKeys.length - Math.PI / 2;
    const r = (value / maxValue) * maxRadius;
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
    return `${x},${y}`;
  });
  return values.join(" ");
};

const polygonPoints = computed(() => toPolygonPoints(radarMetrics.value));

const axes = computed(() =>
  axisKeys.map((key, index) => {
    const angle = (Math.PI * 2 * index) / axisKeys.length - Math.PI / 2;
    const x = centerX + maxRadius * Math.cos(angle);
    const y = centerY + maxRadius * Math.sin(angle);
    return { key, x, y };
  }),
);

const vqLoading = ref(false);
const vqError = ref<string | null>(null);
const vqSnapshot = ref<VqResultsSnapshot | null>(null);
const vqSnapshotTitle = ref<string | null>(null);
const vqSnapshotCachedAt = ref<string | null>(null);
const vqPredicted = ref<VqPredictedMetrics | null>(null);
const vqDatasetKeyOverride = ref<string>("");
const vqHardwareModelName = ref<string | null>(null);
const AUTO_DATASET_VALUE = "__auto__";

const vqDatasetKeyOverrideSelection = computed<string>({
  get: () => vqDatasetKeyOverride.value || AUTO_DATASET_VALUE,
  set: (value) => {
    vqDatasetKeyOverride.value = value === AUTO_DATASET_VALUE ? "" : value;
  },
});

const vqDatasetSelectionLabel = computed(() => {
  if (!vqDatasetKeyOverride.value) return t("vqResults.datasetAuto");
  return vqDatasetKeyOverride.value;
});

const overrideStorageKey = computed(() => {
  const enc = String(props.preset?.video?.encoder ?? "").trim();
  if (!enc) return null;
  return `ffui.vqResults.overrideKey.${enc.toLowerCase()}`;
});

watch(
  overrideStorageKey,
  (key) => {
    if (!key) {
      vqDatasetKeyOverride.value = "";
      return;
    }
    vqDatasetKeyOverride.value = localStorage.getItem(key) ?? "";
  },
  { immediate: true },
);

const datasetKeyFilter = computed(() => {
  const enc = String(props.preset?.video?.encoder ?? "").toLowerCase();
  if (!enc) return null;
  if (enc === "libx264") return "x264_";
  if (enc === "libx265") return "x265_";
  if (enc === "libsvtav1") return "svtav1_";
  if (enc.includes("nvenc")) {
    const codec = enc.includes("av1") ? "AV1" : enc.includes("hevc") ? "HEVC" : "H_264";
    return `_NVEncC_${codec}_`;
  }
  if (enc.includes("_qsv")) {
    const codec = enc.includes("av1") ? "AV1" : "HEVC";
    return `_QSVEncC_${codec}_`;
  }
  if (enc.includes("_amf")) {
    const codec = enc.includes("av1") ? "AV1" : "HEVC";
    return `_VCEEncC_${codec}_`;
  }
  return null;
});

const candidateDatasetKeys = computed(() => {
  const snapshot = vqSnapshot.value;
  const filter = datasetKeyFilter.value;
  if (!snapshot || !filter) return [];
  const keys = new Set<string>();
  for (const d of snapshot.datasets) {
    if (d.set !== 1 && d.set !== 2) continue;
    if (d.metric !== "vmaf") continue;
    if (!d.key.includes(filter)) continue;
    keys.add(d.key);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
});

const ensureHardwareModelName = async (): Promise<string | null> => {
  if (!hasTauri()) return null;
  if (vqHardwareModelName.value != null) return vqHardwareModelName.value;
  try {
    const gpu = await fetchGpuUsage();
    vqHardwareModelName.value = gpu.model ?? null;
  } catch {
    vqHardwareModelName.value = null;
  }
  return vqHardwareModelName.value;
};

const recomputePrediction = async () => {
  if (!props.preset) {
    vqPredicted.value = null;
    return;
  }
  if (String(props.preset.video?.encoder ?? "") === "copy") {
    vqSnapshot.value = null;
    vqSnapshotTitle.value = null;
    vqSnapshotCachedAt.value = null;
    vqPredicted.value = null;
    return;
  }
  vqLoading.value = true;
  vqError.value = null;
  try {
    const snapshot = await loadVqResultsSnapshot();
    vqSnapshot.value = snapshot;
    vqSnapshotTitle.value = snapshot.source.title;
    vqSnapshotCachedAt.value = snapshot.source.fetchedAtIso;

    const enc = String(props.preset.video?.encoder ?? "").toLowerCase();
    const hardwareModelNameHint = enc.includes("nvenc") ? await ensureHardwareModelName() : null;
    vqPredicted.value =
      predictFromVqResults(snapshot, props.preset, {
        datasetKeyOverride: vqDatasetKeyOverride.value,
        hardwareModelNameHint,
      }) ?? null;
  } catch (err: unknown) {
    console.error("failed to load quality snapshot data", err);
    vqError.value = err instanceof Error ? err.message : String(err ?? "Unknown error");
    vqPredicted.value = null;
  } finally {
    vqLoading.value = false;
  }
};

const predictionInputKey = computed(() => {
  const p = props.preset;
  if (!p) return "";
  return JSON.stringify({
    enc: p.video?.encoder,
    preset: p.video?.preset,
    rc: p.video?.rateControl,
    q: p.video?.qualityValue,
    pixFmt: (p.video as any)?.pixFmt,
    stats: p.stats,
  });
});

const isVitest = typeof process !== "undefined" && Boolean((process as any)?.env?.VITEST);

onMounted(() => {
  if (isVitest) return;
  void recomputePrediction();
});

watch(predictionInputKey, () => {
  if (isVitest) return;
  void recomputePrediction();
});

watch(vqDatasetKeyOverride, (value) => {
  const key = overrideStorageKey.value;
  if (!key) return;
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
  if (isVitest) return;
  void recomputePrediction();
});
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold text-foreground">
        {{ t("presetEditor.panel.insightsTitle") }}
      </h3>
      <span class="text-[10px] text-muted-foreground">
        {{ hasStats ? t("presetEditor.panel.insightsWithStats") : t("presetEditor.panel.insightsNoStats") }}
      </span>
    </div>

    <svg width="128" height="128" viewBox="0 0 128 128" class="mx-auto block" aria-hidden="true">
      <!-- 背景网格圆 -->
      <circle
        v-for="level in [0.25, 0.5, 0.75, 1]"
        :key="level"
        :cx="centerX"
        :cy="centerY"
        :r="maxRadius * level"
        class="fill-none stroke-border/60"
        stroke-width="0.5"
      />

      <!-- 轴线 -->
      <line
        v-for="axis in axes"
        :key="axis.key"
        :x1="centerX"
        :y1="centerY"
        :x2="axis.x"
        :y2="axis.y"
        class="stroke-border/80"
        stroke-width="0.5"
      />

      <!-- 雷达多边形 -->
      <polygon :points="polygonPoints" class="fill-primary/20 stroke-primary" stroke-width="1" />

      <!-- 轴标签 -->
      <text
        v-for="axis in axes"
        :key="axis.key"
        :x="axis.x"
        :y="axis.y"
        class="text-[9px] fill-foreground"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        <tspan v-if="axis.key === 'quality'">
          {{ t("presetEditor.panel.radarQuality") }}
        </tspan>
        <tspan v-else-if="axis.key === 'sizeSaving'">
          {{ t("presetEditor.panel.radarSize") }}
        </tspan>
        <tspan v-else-if="axis.key === 'speed'">
          {{ t("presetEditor.panel.radarSpeed") }}
        </tspan>
        <tspan v-else-if="axis.key === 'compatibility'">
          {{ t("presetEditor.panel.radarCompatibility") }}
        </tspan>
        <tspan v-else>
          {{ t("presetEditor.panel.radarPopularity") }}
        </tspan>
      </text>
    </svg>

    <div class="flex justify-between text-[10px] text-muted-foreground">
      <span>{{ t("presetEditor.panel.radarLow") }}</span>
      <span>{{ t("presetEditor.panel.radarHigh") }}</span>
    </div>

    <div
      v-if="statsSummary"
      class="rounded-md border border-border/60 bg-muted/40 p-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-muted-foreground"
    >
      <div class="flex items-center gap-1">
        <span class="font-medium text-foreground">{{ t("presetEditor.panel.radarStatsSpeedLabel") }}</span>
      </div>
      <div class="text-right font-mono text-foreground">
        {{ formatMbPerSec(statsSummary.speed) }}
      </div>

      <div class="flex items-center gap-1">
        <span class="font-medium text-foreground">{{ t("presetEditor.panel.radarStatsSizeLabel") }}</span>
      </div>
      <div class="text-right font-mono text-foreground">
        {{ formatPercent(statsSummary.ratio) }}
      </div>

      <div class="flex items-center gap-1">
        <span class="font-medium text-foreground">{{ t("presetEditor.panel.radarStatsSampleLabel") }}</span>
      </div>
      <div class="text-right font-mono text-foreground">
        {{ statsSummary.usageCount }} · {{ formatInputSize(statsSummary.totalInputSizeMB) }} ·
        {{ formatMetricNumber(statsSummary.totalTimeSeconds, 1) }}s
      </div>
    </div>

    <div class="rounded-md border border-border/60 bg-muted/40 p-2 space-y-2" data-testid="preset-vq-results">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1 min-w-0">
          <span class="text-[10px] font-semibold text-foreground">{{ t("vqResults.title") }}</span>
          <HelpTooltipIcon :text="t('vqResults.note')" side="top" />
        </div>
      </div>

      <div v-if="vqLoading" class="text-[10px] text-muted-foreground">
        {{ t("vqResults.loading") }}
      </div>
      <div v-else-if="vqError" class="text-[10px] text-amber-400 break-words">
        {{ vqError }}
      </div>
      <div v-else-if="preset?.video?.encoder === 'copy'" class="text-[10px] text-muted-foreground">
        {{ t("vqResults.notApplicable") }}
      </div>
      <div v-else-if="!preset" class="text-[10px] text-muted-foreground">
        {{ t("vqResults.noPreset") }}
      </div>
      <div v-else-if="!vqSnapshot" class="text-[10px] text-muted-foreground">
        {{ t("vqResults.unavailable") }}
      </div>
      <div v-else-if="!vqPredicted" class="text-[10px] text-muted-foreground">
        {{ t("vqResults.noMatch") }}
      </div>
      <div v-else class="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <div class="flex items-center gap-1">
          <span class="font-medium text-foreground">{{ t("vqResults.metrics.vmafLabel") }}</span>
          <HelpTooltipIcon :text="t('vqResults.metrics.vmafHelp')" side="top" />
        </div>
        <div class="text-right font-mono text-foreground" data-testid="preset-vq-vmaf">
          {{ formatMetricRange(vqPredicted.vmaf, 2) }}
        </div>

        <div class="flex items-center gap-1">
          <span class="font-medium text-foreground">{{ t("vqResults.metrics.ssimLabel") }}</span>
          <HelpTooltipIcon :text="t('vqResults.metrics.ssimHelp')" side="top" />
        </div>
        <div class="text-right font-mono text-foreground" data-testid="preset-vq-ssim">
          {{ formatMetricRange(vqPredicted.ssim, 4) }}
        </div>

        <div class="flex items-center gap-1 col-span-1">
          <span class="font-medium text-foreground">{{ t("vqResults.metrics.bitrateLabel") }}</span>
          <HelpTooltipIcon :text="t('vqResults.metrics.bitrateHelp')" side="top" />
        </div>
        <div class="text-right font-mono text-foreground" data-testid="preset-vq-bitrate">
          {{ formatMetricNumber(vqPredicted.bitrateKbps, 0) }}k
        </div>
      </div>

      <div v-if="vqSnapshotTitle || vqSnapshotCachedAt" class="text-[10px] text-muted-foreground space-y-0.5">
        <div v-if="showVqAdvancedControls && candidateDatasetKeys.length > 0" class="space-y-1">
          <div class="flex items-center gap-1">
            <span class="font-medium text-foreground">{{ t("vqResults.dataset") }}:</span>
          </div>
          <Select v-model="vqDatasetKeyOverrideSelection">
            <SelectTrigger class="h-7 text-[10px]">
              <SelectValue>{{ vqDatasetSelectionLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="AUTO_DATASET_VALUE">
                {{ t("vqResults.datasetAuto") }}
              </SelectItem>
              <SelectItem v-for="key in candidateDatasetKeys" :key="key" :value="key">
                {{ key }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-if="vqHardwareModelName">
          <span class="font-medium text-foreground">{{ t("vqResults.hardwareModel") }}:</span>
          <span class="ml-1">{{ vqHardwareModelName }}</span>
        </div>
        <div v-if="vqSnapshotTitle">
          <span class="font-medium text-foreground">{{ t("vqResults.source") }}:</span>
          <span class="ml-1">{{ vqSnapshotTitle }}</span>
        </div>
        <div v-if="vqSnapshotCachedAt">
          <span class="font-medium text-foreground">{{ t("vqResults.cachedAt") }}:</span>
          <span class="ml-1 font-mono">{{ vqSnapshotCachedAt }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
