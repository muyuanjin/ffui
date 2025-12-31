<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import type { EncoderCodecTag } from "./usePresetVideoTabOptions";

type EncoderOption = { value: string; label: string; codecTag: EncoderCodecTag };
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

const { t } = useI18n();

const encoderCodecFilter = ref<"all" | EncoderCodecTag>("all");
const setEncoderCodecFilter = (tag: "all" | EncoderCodecTag) => {
  encoderCodecFilter.value = tag;
};
const encoderCodecFilterLabel = (tag: "all" | EncoderCodecTag) => {
  const key = tag === "all" ? "presetEditor.video.encoderFilterAll" : `presetEditor.video.encoderFilter.${String(tag)}`;
  const translated = t(key);
  return translated && translated !== key ? translated : String(tag);
};

const currentEncoderValue = computed(() => String(props.modelValue ?? "").trim());
const filteredOptionGroups = computed(() => {
  const filter = encoderCodecFilter.value;
  const current = currentEncoderValue.value;
  return props.optionGroups
    .map((g) => ({
      tag: g.tag,
      options: g.options.filter((opt) => {
        if (String(opt.value) === current) return true;
        if (filter === "all") return true;
        return opt.codecTag === filter;
      }),
    }))
    .filter((g) => g.options.length > 0);
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
    <div class="flex flex-wrap gap-1 mb-2">
      <span class="text-[10px] text-muted-foreground mr-1 self-center">
        {{ t("presetEditor.video.encoderFilterLabel") }}
      </span>
      <Toggle
        variant="outline"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :model-value="encoderCodecFilter === 'all'"
        @update:model-value="() => setEncoderCodecFilter('all')"
      >
        {{ encoderCodecFilterLabel("all") }}
      </Toggle>
      <Toggle
        v-for="tag in ['h264', 'h265', 'av1', 'copy'] as const"
        :key="tag"
        variant="outline"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :model-value="encoderCodecFilter === tag"
        @update:model-value="() => setEncoderCodecFilter(tag)"
      >
        {{ encoderCodecFilterLabel(tag) }}
      </Toggle>
    </div>
    <Select :model-value="props.modelValue" @update:model-value="handleUpdate">
      <SelectTrigger class="h-9">
        <SelectValue>{{ props.currentLabel }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup v-for="group in filteredOptionGroups" :key="group.tag">
          <SelectLabel>{{ encoderCodecFilterLabel(group.tag) }}</SelectLabel>
          <SelectItem v-for="opt in group.options" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <p v-if="props.unknownWarning" class="text-[10px] text-amber-400 mt-1">
      {{ props.unknownWarning }}
    </p>
  </div>
</template>
