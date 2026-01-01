<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeepWritable, VideoConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  video: VideoConfig;
}>();

const video: DeepWritable<VideoConfig> = props.video;
const { t } = useI18n();

type VbvMode = "off" | "recommended" | "custom";
type MaxrateFactor = 1.2 | 1.5 | 2;
type BufsizeFactor = 1 | 2 | 3;

const normalizedRateControl = computed(() =>
  String(video.rateControl ?? "")
    .trim()
    .toLowerCase(),
);

const isBitrateMode = computed(() => normalizedRateControl.value === "cbr" || normalizedRateControl.value === "vbr");

const vbvMode = ref<VbvMode>("off");
const maxrateFactor = ref<MaxrateFactor>(1.5);
const bufsizeFactor = ref<BufsizeFactor>(2);

const ALL_MAXRATE_FACTORS: MaxrateFactor[] = [1.2, 1.5, 2];
const ALL_BUFSIZE_FACTORS: BufsizeFactor[] = [1, 2, 3];

const hasMaxrate = computed(
  () => typeof video.maxBitrateKbps === "number" && Number.isFinite(video.maxBitrateKbps) && video.maxBitrateKbps > 0,
);
const hasBufsize = computed(
  () =>
    typeof video.bufferSizeKbits === "number" && Number.isFinite(video.bufferSizeKbits) && video.bufferSizeKbits > 0,
);

const targetBitrate = computed<number | undefined>({
  get() {
    return typeof video.bitrateKbps === "number" && Number.isFinite(video.bitrateKbps) && video.bitrateKbps > 0
      ? video.bitrateKbps
      : undefined;
  },
  set(value) {
    video.bitrateKbps =
      typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  },
});

const inferRecommendedFactors = (): { maxrateFactor: MaxrateFactor; bufsizeFactor: BufsizeFactor } | null => {
  const bitrateRaw = video.bitrateKbps;
  const bitrate =
    typeof bitrateRaw === "number" && Number.isFinite(bitrateRaw) && bitrateRaw > 0
      ? Math.floor(bitrateRaw)
      : undefined;
  if (!bitrate) return null;
  const maxrate = hasMaxrate.value ? Math.floor(video.maxBitrateKbps as number) : undefined;
  const bufsize = hasBufsize.value ? Math.floor(video.bufferSizeKbits as number) : undefined;
  if (!maxrate || !bufsize) return null;

  const candidates: MaxrateFactor[] = normalizedRateControl.value === "cbr" ? [1.5] : ALL_MAXRATE_FACTORS;
  // For CBR we effectively want maxrate==bitrate; treat it as a special-case match.
  const maxrateMatches = (factor: MaxrateFactor) => {
    const expected = normalizedRateControl.value === "cbr" ? bitrate : Math.max(1, Math.floor(bitrate * factor));
    return expected === maxrate;
  };

  for (const mf of candidates) {
    if (!maxrateMatches(mf)) continue;
    for (const bf of ALL_BUFSIZE_FACTORS) {
      const expectedBuf = Math.max(1, Math.floor(maxrate * bf));
      if (expectedBuf === bufsize) return { maxrateFactor: mf, bufsizeFactor: bf };
    }
  }
  return null;
};

const deriveInitialMode = (): VbvMode => {
  if (!hasMaxrate.value && !hasBufsize.value) return "off";
  return inferRecommendedFactors() ? "recommended" : "custom";
};

watch(
  () => [isBitrateMode.value, video.maxBitrateKbps, video.bufferSizeKbits],
  () => {
    if (!isBitrateMode.value) return;
    vbvMode.value = deriveInitialMode();
    const inferred = inferRecommendedFactors();
    if (inferred) {
      maxrateFactor.value = inferred.maxrateFactor;
      bufsizeFactor.value = inferred.bufsizeFactor;
    }
  },
  { immediate: true },
);

const setPositiveInt = (raw: unknown): number | undefined => {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return undefined;
  const v = Math.floor(n);
  return v > 0 ? v : undefined;
};

const recommendedMaxrate = computed<number | undefined>(() => {
  if (!targetBitrate.value) return undefined;
  const base = targetBitrate.value;
  const factor = normalizedRateControl.value === "cbr" ? 1 : maxrateFactor.value;
  return Math.max(1, Math.floor(base * factor));
});

const recommendedBufsize = computed<number | undefined>(() => {
  const maxrate = recommendedMaxrate.value;
  if (!maxrate) return undefined;
  return Math.max(1, Math.floor(maxrate * bufsizeFactor.value));
});

const applyRecommendedVbv = () => {
  if (!recommendedMaxrate.value || !recommendedBufsize.value) return;
  video.maxBitrateKbps = recommendedMaxrate.value;
  video.bufferSizeKbits = recommendedBufsize.value;
  vbvMode.value = "recommended";
};

const clearVbv = () => {
  video.maxBitrateKbps = undefined;
  video.bufferSizeKbits = undefined;
  vbvMode.value = "off";
};

watch(
  () => [vbvMode.value, recommendedMaxrate.value, recommendedBufsize.value] as const,
  ([mode, maxrate, bufsize]) => {
    if (mode !== "recommended") return;
    if (!maxrate || !bufsize) return;
    video.maxBitrateKbps = maxrate;
    video.bufferSizeKbits = bufsize;
  },
);

const twoPassChecked = computed<boolean>({
  get() {
    return video.pass === 1 || video.pass === 2;
  },
  set(value) {
    video.pass = value ? 2 : undefined;
  },
});

const twoPassDisabledReason = computed(() => {
  if (!isBitrateMode.value) return t("presetEditor.video.twoPassDisabledNotBitrate");
  if (!targetBitrate.value) return t("presetEditor.video.twoPassDisabledNoBitrate");
  return "";
});

const quickBitrates = [2000, 4000, 6000, 8000, 12000, 20000] as const;

const vbvStatusText = computed(() => {
  if (vbvMode.value === "off") return t("presetEditor.video.vbvModeOff");
  if (vbvMode.value === "recommended") {
    return t("presetEditor.video.vbvModeRecommendedApplied", {
      maxrateFactor: normalizedRateControl.value === "cbr" ? 1 : maxrateFactor.value,
      bufsizeFactor: bufsizeFactor.value,
    });
  }
  return t("presetEditor.video.vbvModeCustom");
});

const vbvWarning = computed(() => {
  if (!isBitrateMode.value) return "";
  if (!targetBitrate.value) return "";
  const maxrate = typeof video.maxBitrateKbps === "number" ? video.maxBitrateKbps : undefined;
  if (typeof maxrate === "number" && Number.isFinite(maxrate) && maxrate > 0 && maxrate < targetBitrate.value) {
    return t("presetEditor.video.vbvWarningMaxrateBelowBitrate");
  }
  return "";
});

const vbvError = computed(() => {
  if (!isBitrateMode.value) return "";
  if (!targetBitrate.value) return "";
  const maxrate = typeof video.maxBitrateKbps === "number" ? video.maxBitrateKbps : undefined;
  if (typeof maxrate === "number" && Number.isFinite(maxrate) && maxrate > 0 && maxrate < targetBitrate.value) {
    return t("presetEditor.video.vbvErrorMaxrateBelowBitrate", { bitrate: targetBitrate.value, maxrate });
  }
  return "";
});

const fixMaxrateToBitrate = () => {
  if (!targetBitrate.value) return;
  video.maxBitrateKbps = Math.floor(targetBitrate.value);
};

const bufsizeRangeWarning = computed(() => {
  const maxrate =
    typeof video.maxBitrateKbps === "number" && Number.isFinite(video.maxBitrateKbps)
      ? video.maxBitrateKbps
      : undefined;
  const bufsize =
    typeof video.bufferSizeKbits === "number" && Number.isFinite(video.bufferSizeKbits)
      ? video.bufferSizeKbits
      : undefined;
  if (!maxrate || !bufsize) return "";
  const min = Math.floor(maxrate);
  const max = Math.floor(maxrate * 3);
  if (bufsize < min || bufsize > max) {
    return t("presetEditor.video.vbvWarningBufsizeOutOfRange", { bufsize, min, max });
  }
  return "";
});

const fixBufsizeTo2xMaxrate = () => {
  const maxrate =
    typeof video.maxBitrateKbps === "number" && Number.isFinite(video.maxBitrateKbps)
      ? video.maxBitrateKbps
      : undefined;
  if (!maxrate) return;
  video.bufferSizeKbits = Math.floor(maxrate * 2);
};
</script>

<template>
  <div v-if="isBitrateMode" class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h4 class="font-medium text-sm">
      {{ t("presetEditor.video.bitrateSectionTitle") }}
    </h4>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bitrateKbpsLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.bitrateHelp')" />
        </div>
        <Input
          type="number"
          min="1"
          class="h-9 text-xs"
          data-testid="preset-video-bitrate-input"
          data-command-group="video"
          data-command-field="bitrate"
          :model-value="targetBitrate ?? ''"
          @update:model-value="(value) => (targetBitrate = setPositiveInt(value))"
        />
        <div class="mt-2 flex flex-wrap gap-1.5">
          <Button
            v-for="kbps in quickBitrates"
            :key="kbps"
            type="button"
            variant="secondary"
            size="xs"
            class="h-6 px-2 text-[10px] tabular-nums"
            @click="targetBitrate = kbps"
          >
            {{ kbps }}k
          </Button>
        </div>
      </div>

      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.vbvLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.vbvHelp')" />
        </div>
        <Select :model-value="vbvMode" @update:model-value="(value) => (vbvMode = value as VbvMode)">
          <SelectTrigger class="h-9 text-xs" data-testid="preset-video-vbv-mode-trigger">
            <SelectValue>{{ vbvStatusText }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{{ t("presetEditor.video.vbvModeOff") }}</SelectItem>
            <SelectItem value="recommended">{{ t("presetEditor.video.vbvModeRecommended") }}</SelectItem>
            <SelectItem value="custom">{{ t("presetEditor.video.vbvModeCustom") }}</SelectItem>
          </SelectContent>
        </Select>

        <div v-if="vbvError" class="mt-1 flex items-center justify-between gap-2">
          <p class="text-[10px] text-destructive">
            {{ vbvError }}
          </p>
          <Button type="button" variant="ghost" size="xs" class="h-6 px-2 text-[10px]" @click="fixMaxrateToBitrate">
            {{ t("presetEditor.video.fixMaxrateToBitrate") }}
          </Button>
        </div>
        <p v-else-if="vbvWarning" class="mt-1 text-[10px] text-amber-400">
          {{ vbvWarning }}
        </p>
      </div>
    </div>

    <div v-if="vbvMode === 'recommended'" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.maxrateFactorLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.maxrateFactorHelp')" />
        </div>
        <Select
          :model-value="String(maxrateFactor)"
          @update:model-value="(value) => (maxrateFactor = (Number(value) as MaxrateFactor) || 1.5)"
        >
          <SelectTrigger class="h-9 text-xs" data-testid="preset-video-maxrate-factor-trigger">
            <SelectValue>{{ String(maxrateFactor) }}×</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1.2">1.2×</SelectItem>
            <SelectItem value="1.5">1.5×</SelectItem>
            <SelectItem value="2">2×</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bufsizeFactorLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.bufsizeFactorHelp')" />
        </div>
        <Select
          :model-value="String(bufsizeFactor)"
          @update:model-value="(value) => (bufsizeFactor = (Number(value) as BufsizeFactor) || 2)"
        >
          <SelectTrigger class="h-9 text-xs" data-testid="preset-video-bufsize-factor-trigger">
            <SelectValue>{{ String(bufsizeFactor) }}×</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1×</SelectItem>
            <SelectItem value="2">2×</SelectItem>
            <SelectItem value="3">3×</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-col justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          class="h-9 text-xs"
          :disabled="!recommendedMaxrate || !recommendedBufsize"
          data-testid="preset-video-apply-vbv-btn"
          @click="applyRecommendedVbv"
        >
          {{
            t("presetEditor.video.applyRecommendedVbv", { maxrate: recommendedMaxrate, bufsize: recommendedBufsize })
          }}
        </Button>
        <Button type="button" variant="ghost" class="h-8 text-xs" @click="clearVbv">
          {{ t("presetEditor.video.clearVbv") }}
        </Button>
      </div>
    </div>

    <div v-else-if="vbvMode === 'custom'" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.maxBitrateKbpsLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.maxBitrateKbpsHelp')" />
        </div>
        <Input
          type="number"
          min="1"
          class="h-9 text-xs"
          :model-value="video.maxBitrateKbps ?? ''"
          data-command-group="video"
          data-command-field="maxrate"
          @update:model-value="(value) => (video.maxBitrateKbps = setPositiveInt(value))"
        />
      </div>
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bufferSizeKbitsLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.bufferSizeKbitsHelp')" />
        </div>
        <Input
          type="number"
          min="1"
          class="h-9 text-xs"
          :model-value="video.bufferSizeKbits ?? ''"
          data-command-group="video"
          data-command-field="bufsize"
          @update:model-value="(value) => (video.bufferSizeKbits = setPositiveInt(value))"
        />
        <div v-if="bufsizeRangeWarning" class="mt-1 flex items-center justify-between gap-2">
          <p class="text-[10px] text-amber-400">
            {{ bufsizeRangeWarning }}
          </p>
          <Button type="button" variant="ghost" size="xs" class="h-6 px-2 text-[10px]" @click="fixBufsizeTo2xMaxrate">
            {{ t("presetEditor.video.fixBufsizeTo2xMaxrate") }}
          </Button>
        </div>
      </div>
    </div>

    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2">
        <label class="inline-flex items-center gap-2 text-[11px]">
          <Checkbox
            v-model:checked="twoPassChecked"
            class="h-3 w-3 border-border bg-background"
            :disabled="!!twoPassDisabledReason"
            data-testid="preset-video-two-pass-toggle"
            data-command-group="video"
            data-command-field="pass"
          />
          <span>
            {{ t("presetEditor.video.passLabel") }}
          </span>
        </label>
        <HelpTooltipIcon :text="t('presetEditor.video.passHelp')" />
      </div>
      <p v-if="twoPassDisabledReason" class="text-[10px] text-muted-foreground text-right">
        {{ twoPassDisabledReason }}
      </p>
    </div>
  </div>
</template>
