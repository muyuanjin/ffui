<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, VideoConfig } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";
import {
  applyEncoderChangePatch,
  applyRateControlChangePatch,
  getEncoderCapability,
} from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import { getQualityRecommendation } from "@/lib/presetEditorContract/qualityRecommendations";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import PresetVideoAdvancedFields from "@/components/preset-editor/PresetVideoAdvancedFields.vue";
import PresetVideoEncoderSelect from "./PresetVideoEncoderSelect.vue";
import { usePresetVideoTabOptions } from "./usePresetVideoTabOptions";
import { getNvencPresetHintClass, getNvencPresetHintId, isNvencPresetValue } from "./nvencPresetHints";
const props = defineProps<{
  video: VideoConfig;
  isCopyEncoder: boolean;
  rateControlLabel: string;
}>();
const video: DeepWritable<VideoConfig> = props.video;
const { t } = useI18n();
const isNvencEncoder = computed(
  () => typeof video.encoder === "string" && video.encoder.toLowerCase().includes("nvenc"),
);
const rateControlDisplayLabel = (mode: string) => {
  const raw = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  const key = `presetEditor.video.rateControlDisplay.${raw}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  if (raw === "constqp") return "ConstQP";
  return raw.toUpperCase();
};
const passModeLabel = computed(() => {
  const raw = video.pass ? String(video.pass) : "single";
  const map: Record<string, string> = {
    single: t("presetEditor.video.passSingle"),
    "1": t("presetEditor.video.passFirst"),
    "2": t("presetEditor.video.passSecond"),
  };
  return map[raw] ?? raw;
});
const normalizedRateControl = computed(() =>
  String(video.rateControl ?? "")
    .trim()
    .toLowerCase(),
);
const isQualityMode = computed(() => ["crf", "cq", "constqp"].includes(normalizedRateControl.value));
const isBitrateMode = computed(() => ["vbr", "cbr"].includes(normalizedRateControl.value));
const selectedRateControlLabel = computed(() => rateControlDisplayLabel(String(video.rateControl ?? "")));
const qualityModeLabel = computed(() => {
  const mode = normalizedRateControl.value;
  if (mode === "crf") return "CRF";
  if (mode === "cq") {
    const enc = String(video.encoder ?? "").toLowerCase();
    if (enc.includes("_qsv")) return "global_quality";
    if (enc.includes("_amf")) return "QP";
    return "CQ";
  }
  if (mode === "constqp") return "QP";
  return "CRF";
});
const presetHelpText = computed(() => t("presetEditor.video.presetHelp"));

const rateControlOptionTitle = (mode: string) => {
  const key = `presetEditor.video.rateControlOptionHelp.${String(mode ?? "")
    .trim()
    .toLowerCase()}`;
  const translated = t(key);
  if (translated && translated !== key) return translated;
  return t("presetEditor.video.rateControlHelp");
};

const presetOptionTitle = (value: string) => {
  const v = String(value ?? "").trim();
  const encoder = String(video.encoder ?? "").toLowerCase();
  if (!v) return presetHelpText.value;
  if (encoder.includes("nvenc") && isNvencPresetValue(v)) {
    const hint = nvencPresetHint(v);
    if (hint) return `${v}: ${hint}. ${presetHelpText.value}`;
  }
  return presetHelpText.value;
};

const {
  toUnknownLabel,
  encoderOptionsWithUnknown,
  encoderOptionGroups,
  currentEncoderLabel,
  rateControlOptionsForEncoder,
  knownRateControlSet,
  presetOptionsForEncoder,
  knownPresetSet,
  qualityRange,
} = usePresetVideoTabOptions(video, t);

const qualityRec = computed(() => getQualityRecommendation(video.encoder));
const formatRecommendedRange = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`);

const encoderUnknownWarning = computed(() => {
  if (!encoderOptionsWithUnknown.value[0]?.unknown) return "";
  return t("presetEditor.video.unknownValueWarning", { field: "encoder", value: String(video.encoder) });
});

const recommendedRateControl = computed(() => getEncoderCapability(video.encoder)?.defaultRateControl ?? "crf");
const isRecommendedRateControl = (mode: string) =>
  String(mode ?? "")
    .trim()
    .toLowerCase() === String(recommendedRateControl.value).trim().toLowerCase();
const rateControlValueClass = computed(() => (isRecommendedRateControl(video.rateControl) ? "text-emerald-300" : ""));
const rateControlItemClass = (mode: string) => {
  const raw = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (!knownRateControlSet.value.has(raw as any)) return "";
  if (isRecommendedRateControl(raw)) return "text-emerald-300";
  if (raw === "constqp") return "text-amber-300";
  return "";
};

const nvencPresetHint = (value: string) => {
  const id = getNvencPresetHintId(value);
  if (!id) return "";
  const tKey = `presetEditor.video.nvencPresetHint.${id}`;
  const translated = t(tKey);
  return translated && translated !== tKey ? translated : "";
};
const presetValueLabel = (value: string) => {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (isNvencEncoder.value && isNvencPresetValue(v)) {
    const hint = nvencPresetHint(v);
    return hint ? `${v} · ${hint}` : v;
  }
  return v;
};
const presetValueClass = computed(() => {
  const v = String(video.preset ?? "")
    .trim()
    .toLowerCase();
  if (!isNvencEncoder.value || !isNvencPresetValue(v)) return "";
  const cls = getNvencPresetHintClass(v);
  return cls === "text-muted-foreground" ? "" : cls;
});
const presetLegendText = computed(() => {
  const enc = String(video.encoder ?? "").toLowerCase();
  if (enc.includes("nvenc")) return t("presetEditor.tips.preset_nvenc");
  if (enc === "libsvtav1" || enc.includes("av1")) return t("presetEditor.tips.preset_av1");
  if (enc.startsWith("libx26")) return t("presetEditor.tips.preset_x264");
  return "";
});
</script>

<template>
  <div class="space-y-3">
    <PresetVideoEncoderSelect
      :model-value="video.encoder"
      :current-label="currentEncoderLabel"
      :option-groups="encoderOptionGroups"
      :unknown-warning="encoderUnknownWarning"
      @update:model-value="
        (value) => {
          const next = value as VideoConfig['encoder'];
          Object.assign(video, applyEncoderChangePatch(video as VideoConfig, next));
        }
      "
    />

    <div v-if="!props.isCopyEncoder" class="space-y-3">
      <div
        v-if="isQualityMode"
        class="bg-muted/40 p-3 rounded-md border border-border/60"
        data-testid="preset-video-quality-card"
      >
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium text-sm">{{ qualityModeLabel }}</span>
          <span class="text-primary font-bold text-xl">{{ video.qualityValue }}</span>
        </div>
        <Slider
          :min="qualityRange.min"
          :max="qualityRange.max"
          :step="1"
          :model-value="[video.qualityValue]"
          class="w-full"
          @update:model-value="
            (value) => {
              const v = (value as number[])[0];
              if (typeof v === 'number') {
                video.qualityValue = v;
              }
            }
          "
        />
        <div v-if="qualityRec" class="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span class="font-medium text-foreground">{{ t("common.recommended") }}:</span>
          <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
            {{ formatRecommendedRange(qualityRec.range.min, qualityRec.range.max) }}
          </span>
          <HelpTooltipIcon :text="t('presetEditor.tips.quality_equivalence')" side="top" />
        </div>
        <p class="mt-1 text-[10px] text-muted-foreground">
          <span v-if="video.encoder === 'libx264'">
            {{ t("presetEditor.tips.crf_x264") }}
          </span>
          <span v-else-if="isNvencEncoder">
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

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.rateControlModeLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.rateControlHelp')" />
          </div>
          <Select
            :model-value="video.rateControl"
            @update:model-value="
              (value) => {
                const next = value as VideoConfig['rateControl'];
                Object.assign(video, applyRateControlChangePatch(next));
              }
            "
          >
            <SelectTrigger class="h-9" data-testid="preset-video-rate-control-trigger">
              <SelectValue>
                <span :class="rateControlValueClass">{{ selectedRateControlLabel }}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="m in rateControlOptionsForEncoder"
                :key="m"
                :value="m"
                :title="rateControlOptionTitle(m)"
                :class="rateControlItemClass(m)"
              >
                {{ knownRateControlSet.has(m) ? rateControlDisplayLabel(m) : toUnknownLabel(String(m).toUpperCase()) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[10px] text-muted-foreground mt-1">
            {{ rateControlOptionTitle(String(video.rateControl)) }}
          </p>
          <p v-if="!knownRateControlSet.has(String(video.rateControl))" class="text-[10px] text-amber-400 mt-1">
            {{
              t("presetEditor.video.unknownValueWarning", { field: "rateControl", value: String(video.rateControl) })
            }}
          </p>
        </div>

        <div v-if="isBitrateMode">
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bitrateKbpsLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.bitrateHelp')" />
          </div>
          <Input
            type="number"
            min="0"
            class="h-9 text-xs"
            data-testid="preset-video-bitrate-input"
            :model-value="video.bitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.bitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
        </div>
      </div>

      <div v-if="isBitrateMode" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.maxBitrateKbpsLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.maxBitrateKbpsHelp')" />
          </div>
          <Input
            type="number"
            min="0"
            class="h-9 text-xs"
            :model-value="video.maxBitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.maxBitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
        </div>
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bufferSizeKbitsLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.bufferSizeKbitsHelp')" />
          </div>
          <Input
            type="number"
            min="0"
            class="h-9 text-xs"
            :model-value="video.bufferSizeKbits ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.bufferSizeKbits = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
        </div>
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.passLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.passHelp')" />
          </div>
          <Select
            :model-value="video.pass ? String(video.pass) : 'single'"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                if (value === 'single') {
                  video.pass = undefined;
                } else {
                  video.pass = n === 1 || n === 2 ? (n as 1 | 2) : undefined;
                }
              }
            "
          >
            <SelectTrigger class="h-9" data-testid="preset-video-pass-trigger">
              <SelectValue>{{ passModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">
                {{ t("presetEditor.video.passSingle") }}
              </SelectItem>
              <SelectItem value="1">
                {{ t("presetEditor.video.passFirst") }}
              </SelectItem>
              <SelectItem value="2">
                {{ t("presetEditor.video.passSecond") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.presetLabel") }}</Label>
          <HelpTooltipIcon :text="presetHelpText" />
        </div>
        <Select
          :model-value="video.preset"
          @update:model-value="
            (value) => {
              video.preset = value as string;
            }
          "
        >
          <SelectTrigger class="h-9" data-testid="preset-video-preset-trigger">
            <SelectValue>
              <span :class="presetValueClass">{{ presetValueLabel(video.preset) }}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in presetOptionsForEncoder" :key="p" :value="p" :title="presetOptionTitle(p)">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono">{{ knownPresetSet.has(p) ? p : toUnknownLabel(p) }}</span>
                <span
                  v-if="isNvencEncoder && isNvencPresetValue(p)"
                  class="text-[10px]"
                  :class="getNvencPresetHintClass(p)"
                >
                  {{ nvencPresetHint(p) }}
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p v-if="presetLegendText" class="text-[10px] text-muted-foreground mt-1">
          {{ presetLegendText }}
        </p>
        <p
          v-if="video.encoder !== 'copy' && !knownPresetSet.has(String(video.preset))"
          class="text-[10px] text-amber-400 mt-1"
        >
          {{ t("presetEditor.video.unknownValueWarning", { field: "preset", value: String(video.preset) }) }}
        </p>
      </div>

      <PresetVideoAdvancedFields :video="video" />
    </div>
  </div>
</template>
