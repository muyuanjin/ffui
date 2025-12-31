<script setup lang="ts">
import { computed } from "vue";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EncoderType, VideoConfig, Translate } from "@/types";
import {
  applyRateControlChangePatch,
  getEncoderCapability,
  getQualityRangeForEncoder,
} from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import { getQualityRecommendation } from "@/lib/presetEditorContract/qualityRecommendations";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const { video, encoderOptions, presetOptions, isCopyEncoder, t } = defineProps<{
  video: VideoConfig;
  encoderOptions: { value: EncoderType; label: string }[];
  presetOptions: Record<string, string[]>;
  isCopyEncoder: boolean;
  t: Translate;
}>();

const emit = defineEmits<{
  (e: "change-encoder", value: EncoderType): void;
  (e: "update-video", payload: Partial<VideoConfig>): void;
}>();

const encoderOptionsWithUnknown = computed(() => {
  const current = String(video.encoder ?? "").trim();
  if (!current) return encoderOptions;
  if (encoderOptions.some((opt) => opt.value === current)) return encoderOptions;
  return [
    { value: current as EncoderType, label: t("presetEditor.video.unknownOption", { value: current }) },
    ...encoderOptions,
  ];
});

const currentEncoderLabel = computed(() => {
  const current = String(video.encoder ?? "").trim();
  const match = encoderOptionsWithUnknown.value.find((opt) => String(opt.value) === current);
  return match?.label ?? (current ? t("presetEditor.video.unknownOption", { value: current }) : "");
});

const presetOptionsForEncoder = computed(() => {
  const base = presetOptions[String(video.encoder ?? "")] ?? [];
  const current = String(video.preset ?? "").trim();
  if (!current || base.includes(current)) return base;
  return [current, ...base];
});

const knownPresetSet = computed(() => new Set(presetOptions[String(video.encoder ?? "")] ?? []));
const isUnknownPreset = (value: string) => value && !knownPresetSet.value.has(value);

const qualityRange = computed(() => getQualityRangeForEncoder(video.encoder));
const qualityRec = computed(() => getQualityRecommendation(video.encoder));
const formatRecommendedRange = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`);

const normalizedRateControl = computed(() =>
  String(video.rateControl ?? "")
    .trim()
    .toLowerCase(),
);
const isQualityMode = computed(() => ["crf", "cq", "constqp"].includes(normalizedRateControl.value));
const isBitrateMode = computed(() => ["vbr", "cbr"].includes(normalizedRateControl.value));

const rateControlModeLabel = computed(() => {
  const raw = normalizedRateControl.value;
  if (!raw) return "";
  if (raw === "constqp") return "ConstQP";
  if (raw === "cq") {
    const enc = String(video.encoder ?? "").toLowerCase();
    if (enc.includes("_qsv")) return "global_quality";
    if (enc.includes("_amf")) return "QP";
  }
  return raw.toUpperCase();
});

const rateControlOptionsForEncoder = computed(() => {
  const cap = getEncoderCapability(video.encoder);
  const known = (cap?.rateControlModes ?? []).map((m) => String(m));
  const current = String(video.rateControl ?? "").trim();
  if (!current) return known.length > 0 ? known : ["crf"];
  if (known.includes(current)) return known;
  return [current, ...known];
});

const knownRateControlSet = computed(() => {
  const cap = getEncoderCapability(video.encoder);
  return new Set((cap?.rateControlModes ?? []).map((m) => String(m)));
});

const rateControlOptionTitle = (mode: string) => {
  const key = `presetEditor.video.rateControlOptionHelp.${String(mode ?? "")
    .trim()
    .toLowerCase()}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  return t("presetEditor.video.rateControlHelp");
};

const presetHelpText = computed(() => t("presetEditor.video.presetHelp"));

const presetOptionTitle = (value: string) => {
  const cap = getEncoderCapability(video.encoder);
  const options = cap?.presetOptions ?? [];
  const v = String(value ?? "").trim();
  const idx = options.indexOf(v);
  if (!v || idx < 0) return presetHelpText.value;

  const first = options[0] ?? "";
  const last = options[options.length - 1] ?? "";
  const encoder = String(video.encoder ?? "").toLowerCase();

  if (encoder.includes("nvenc") && /^p\\d+$/.test(v)) {
    if (v === "p1") return `${v}: fastest (least efficient)`;
    if (v === "p7") return `${v}: slowest (best efficiency/quality)`;
    return `${v}: between p1 (fast) and p7 (best)`;
  }

  if (encoder.startsWith("libx26") || encoder === "libx265") {
    if (v === first) return `${v}: fastest (usually larger files)`;
    if (v === "medium") return `${v}: recommended default`;
    if (v === last) return `${v}: slowest (usually smaller files)`;
    return `${v}: slower usually = smaller files`;
  }

  if (encoder === "libsvtav1" && /^\\d+$/.test(v)) {
    if (v === first) return `${v}: fastest (less efficient)`;
    if (v === last) return `${v}: slowest (more efficient)`;
    return `${v}: higher = faster, lower = more efficient`;
  }

  if (options.length > 0 && v === first) return `${v}: speed-oriented`;
  if (options.length > 0 && v === last) return `${v}: quality/efficiency-oriented`;
  return presetHelpText.value;
};
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <div class="flex items-center gap-1">
        <Label>{{ t("presetEditor.video.encoder") }}</Label>
        <HelpTooltipIcon :text="t('presetEditor.video.encoderHelp')" />
      </div>
      <Select
        :model-value="video.encoder"
        @update:model-value="(value) => emit('change-encoder', value as EncoderType)"
      >
        <SelectTrigger>
          <SelectValue>{{ currentEncoderLabel }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt in encoderOptionsWithUnknown" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="isCopyEncoder" class="text-amber-400 text-xs mt-1 flex items-center gap-1">
        {{ t("presetEditor.video.copyWarning") }}
      </p>
    </div>

    <div v-if="!isCopyEncoder" class="space-y-6">
      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label>{{ t("presetEditor.video.rateControlModeLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.rateControlHelp')" />
        </div>
        <Select
          :model-value="video.rateControl"
          @update:model-value="(value) => emit('update-video', applyRateControlChangePatch(value as string))"
        >
          <SelectTrigger class="h-9" data-testid="wizard-video-rate-control-trigger">
            <SelectValue>{{ rateControlModeLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="m in rateControlOptionsForEncoder"
              :key="m"
              :value="m"
              :title="rateControlOptionTitle(m)"
            >
              {{
                knownRateControlSet.has(m)
                  ? String(m).toUpperCase()
                  : t("presetEditor.video.unknownOption", { value: String(m).toUpperCase() })
              }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="bg-muted/40 p-4 rounded-md border border-border/60">
        <template v-if="isQualityMode">
          <div class="flex justify-between items-center mb-2">
            <span class="font-medium">
              {{ rateControlModeLabel }}
            </span>
            <span class="text-primary font-bold text-lg">
              {{ video.qualityValue }}
            </span>
          </div>
          <Slider
            :min="qualityRange.min"
            :max="qualityRange.max"
            :step="1"
            :model-value="[video.qualityValue]"
            class="mt-3"
            @update:model-value="
              (value) => {
                const next = (value as number[])[0];
                if (typeof next === 'number') emit('update-video', { qualityValue: next });
              }
            "
          />
          <div v-if="qualityRec" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span class="font-medium text-foreground">{{ t("common.recommended") }}:</span>
            <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
              {{ formatRecommendedRange(qualityRec.range.min, qualityRec.range.max) }}
            </span>
            <HelpTooltipIcon :text="t('presetEditor.tips.quality_equivalence')" side="top" />
          </div>
          <div class="mt-2 text-xs text-muted-foreground flex gap-2 items-start">
            <span class="text-primary mt-0.5">ℹ</span>
            <p>
              <span v-if="video.encoder === 'libx264'">
                {{ t("presetEditor.tips.crf_x264") }}
              </span>
              <span v-else-if="String(video.encoder ?? '').includes('nvenc')">
                {{ t("presetEditor.tips.cq_nvenc") }}
              </span>
              <span v-else-if="String(video.encoder ?? '').includes('_qsv')">
                {{ t("presetEditor.tips.global_quality_qsv") }}
              </span>
              <span v-else-if="String(video.encoder ?? '').includes('_amf')">
                {{ t("presetEditor.tips.qp_amf") }}
              </span>
              <span v-else-if="video.encoder === 'libsvtav1'">
                {{ t("presetEditor.tips.crf_av1") }}
              </span>
            </p>
          </div>
        </template>
        <template v-else-if="isBitrateMode">
          <div class="space-y-2">
            <div class="flex items-center gap-1">
              <Label class="text-xs">{{ t("presetEditor.video.bitrateKbpsLabel") }}</Label>
              <HelpTooltipIcon :text="t('presetEditor.video.bitrateHelp')" />
            </div>
            <Input
              type="number"
              min="0"
              class="h-9 text-xs"
              data-testid="wizard-video-bitrate-input"
              :model-value="video.bitrateKbps ?? ''"
              @update:model-value="
                (value) => {
                  const n = Number(value ?? '');
                  emit('update-video', { bitrateKbps: Number.isFinite(n) && n > 0 ? n : undefined });
                }
              "
            />
          </div>
        </template>
        <template v-else>
          <p class="text-xs text-muted-foreground">
            {{ t("presetEditor.video.rateControlHelp") }}
          </p>
        </template>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label>{{ t("presetEditor.video.presetLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.presetHelp')" />
        </div>
        <Select
          :model-value="video.preset"
          @update:model-value="(value) => emit('update-video', { preset: value as string })"
        >
          <SelectTrigger data-testid="wizard-video-preset-trigger">
            <SelectValue>{{ video.preset }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in presetOptionsForEncoder" :key="p" :value="p" :title="presetOptionTitle(p)">
              {{ isUnknownPreset(p) ? t("presetEditor.video.unknownOption", { value: p }) : p }}
            </SelectItem>
          </SelectContent>
        </Select>
        <div class="mt-1 text-xs text-muted-foreground">
          <span v-if="video.encoder === 'libx264'">
            {{ t("presetEditor.tips.preset_x264") }}
          </span>
          <span v-else-if="String(video.encoder ?? '').includes('nvenc')">
            {{ t("presetEditor.tips.preset_nvenc") }}
          </span>
          <span v-else-if="video.encoder === 'libsvtav1'">
            {{ t("presetEditor.tips.preset_av1") }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
