<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import type { EncoderCodecTag } from "./usePresetVideoTabOptions";

type EncoderOption = {
  value: string;
  label: string;
  codecTag: EncoderCodecTag;
  hardware?: boolean;
  unknown?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};
type EncoderOptionGroup = { tag: EncoderCodecTag; options: EncoderOption[] };

const props = defineProps<{
  modelValue: string | undefined;
  currentLabel: string;
  optionGroups: EncoderOptionGroup[];
  unknownWarning?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t, te } = useI18n();

const codecTagLabel = (tag: EncoderCodecTag) => {
  const key = `presetEditor.video.encoderFilter.${String(tag)}`;
  const translated = t(key);
  return translated && translated !== key ? translated : String(tag);
};

type EncoderBackendTag = "COPY" | "NVENC" | "QSV" | "AMF" | "CPU" | "OTHER";

const encoderBackendTag = (value: string): EncoderBackendTag => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "OTHER";
  if (raw === "copy") return "COPY";
  if (raw.endsWith("_nvenc")) return "NVENC";
  if (raw.endsWith("_qsv")) return "QSV";
  if (raw.endsWith("_amf")) return "AMF";
  if (raw.startsWith("lib")) return "CPU";
  return "OTHER";
};

const encoderBackendBadgeLabel = (value: string) => {
  const tag = encoderBackendTag(value);
  const i18nKey = `presetEditor.video.encoderBackendTag.${tag}`;
  return te(i18nKey) ? t(i18nKey) : tag;
};

const encoderFamilyHint = (opt: EncoderOption) => {
  const raw = String(opt.value ?? "")
    .trim()
    .toLowerCase();

  let key = "other";
  if (raw === "copy" || opt.codecTag === "copy") key = "copy";
  else if (raw === "libx264") key = "cpu-x264";
  else if (raw === "libx265") key = "cpu-x265";
  else if (raw === "libsvtav1") key = "cpu-av1";
  else if (raw.endsWith("_nvenc") && opt.codecTag === "h264") key = "nvenc-h264";
  else if (raw.endsWith("_nvenc") && opt.codecTag === "h265") key = "nvenc-hevc";
  else if (raw.endsWith("_nvenc") && opt.codecTag === "av1") key = "nvenc-av1";
  else if (raw.endsWith("_qsv")) key = "qsv";
  else if (raw.endsWith("_amf")) key = "amf";

  const i18nKey = `presetEditor.panel.encoderFamily.${key}`;
  return te(i18nKey) ? t(i18nKey) : opt.label;
};

const compactEncoderLabel = (opt: EncoderOption) => {
  const raw = String(opt.value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return opt.label;
  if (raw === "copy") return t("presetEditor.video.encoderCopyLabel");
  const tag = opt.codecTag;
  const codec = codecTagLabel(tag);
  const backend = encoderBackendTag(raw);
  if (raw === "libx264") return `${codec} x264`;
  if (raw === "libx265") return `${codec} x265`;
  if (raw === "libsvtav1") return `${codec} SVT-AV1`;
  if (backend === "CPU") return `${codec} CPU`;
  if (backend !== "OTHER") return `${codec} ${backend}`;
  return opt.label;
};

const flatOptions = computed(() => props.optionGroups.flatMap((g) => g.options));
const hasAnyOptions = computed(() => flatOptions.value.length > 0);
const selectedOption = computed(() => {
  const cur = String(props.modelValue ?? "").trim();
  if (!cur) return undefined;
  return flatOptions.value.find((opt) => String(opt.value) === cur);
});
const selectedLabel = computed(() => {
  if (selectedOption.value) {
    const label = compactEncoderLabel(selectedOption.value);
    const value = String(selectedOption.value.value ?? "").trim();
    return value ? `${label} (${value})` : label;
  }
  return String(props.currentLabel ?? "");
});

const handleUpdate = (value: unknown) => {
  const next = String(value ?? "").trim();
  if (!next) return;
  emit("update:modelValue", next);
};
</script>

<template>
  <div>
    <div class="flex items-center gap-1">
      <Label class="text-xs mb-1 block">{{ t("presetEditor.video.encoder") }}</Label>
      <HelpTooltipIcon :text="t('presetEditor.video.encoderHelp')" />
    </div>
    <Select :model-value="props.modelValue" @update:model-value="handleUpdate">
      <SelectTrigger
        class="h-8 text-xs"
        data-testid="preset-video-encoder-trigger"
        data-command-group="video"
        data-command-field="encoder"
      >
        <SelectValue :placeholder="t('presetEditor.video.encoderPlaceholder')">
          <template v-if="selectedLabel">{{ selectedLabel }}</template>
        </SelectValue>
      </SelectTrigger>
      <SelectContent class="w-[720px] max-h-[80vh]">
        <template v-if="hasAnyOptions">
          <SelectItem
            v-for="opt in flatOptions"
            :key="opt.value"
            :value="opt.value"
            :disabled="!!opt.disabled"
            class="py-1 text-xs pr-2 [&>span.absolute]:hidden [&>[id^='reka-select-item-text']]:flex-1 [&>[id^='reka-select-item-text']]:min-w-0"
            :title="
              opt.disabledReason
                ? `${opt.label} (${String(opt.value)}): ${String(opt.disabledReason)}`
                : `${opt.label} (${String(opt.value)})`
            "
          >
            <div class="grid grid-cols-[minmax(0,1fr)_152px_160px] gap-x-2 w-full items-start">
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate font-medium leading-5">
                    {{ compactEncoderLabel(opt) }}
                  </span>
                </div>
                <div class="mt-0.5 text-[10px] text-muted-foreground leading-4 truncate">
                  {{ encoderFamilyHint(opt) }}
                </div>
                <div
                  v-if="opt.disabled && opt.disabledReason"
                  class="mt-0.5 text-[10px] text-amber-500 leading-4 truncate"
                >
                  {{ opt.disabledReason }}
                </div>
              </div>

              <div class="pt-[2px] grid grid-cols-[56px_1fr] gap-x-1 gap-y-1 items-start justify-items-start shrink-0">
                <Badge
                  variant="outline"
                  class="px-1.5 py-0 text-[9px] font-medium shrink-0 max-w-full truncate"
                  :title="codecTagLabel(opt.codecTag)"
                >
                  {{ codecTagLabel(opt.codecTag) }}
                </Badge>
                <Badge
                  variant="secondary"
                  class="px-1.5 py-0 text-[9px] font-medium shrink-0 max-w-full truncate"
                  :title="encoderBackendBadgeLabel(opt.value)"
                >
                  {{ encoderBackendBadgeLabel(opt.value) }}
                </Badge>
              </div>

              <div class="pt-[2px] text-[10px] text-muted-foreground font-mono tabular-nums text-right truncate">
                {{ String(opt.value) }}
              </div>
            </div>
          </SelectItem>
        </template>

        <template v-else>
          <div class="px-2 py-2 text-xs text-muted-foreground">
            {{ t("presetEditor.video.encoderEmptyHint") }}
          </div>
        </template>
      </SelectContent>
    </Select>
    <p
      class="text-[10px] text-muted-foreground mt-1 leading-4 line-clamp-3"
      :title="t('presetEditor.video.encoderHelp')"
    >
      {{ t("presetEditor.video.encoderHelp") }}
    </p>
    <p v-if="props.unknownWarning" class="text-[10px] text-amber-400 mt-1">
      {{ props.unknownWarning }}
    </p>
  </div>
</template>
