<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";
import type { PresetFieldDef } from "@/lib/presetEditorContract/parameterSchema";
import { CUSTOM_VALUE, selectItemLabelForField } from "./presetSchemaFieldLabels";

const props = defineProps<{
  field: PresetFieldDef<any>;
  model: any;
  isDisabled: boolean;
  commandGroupAttr?: string;
  commandFieldAttr?: string;
}>();

const { t } = useI18n();
const labelFor = (value: string) => selectItemLabelForField(props.field, props.model, value, t);

const inputFileIndexMappingSelectValue = computed<string>(() => {
  if (props.field.kind !== "inputFileIndexMapping") return AUTO_VALUE;
  const idx = props.field.getIndex(props.model);
  if (typeof idx !== "number" || !Number.isFinite(idx)) return AUTO_VALUE;
  if (idx === -1) return "-1";
  if (idx === 0) return "0";
  return CUSTOM_VALUE;
});

const inputFileIndexDraft = ref<string>("");
const inputFileIndexError = ref<string>("");
watch(
  () =>
    [
      props.field.id,
      props.field.kind,
      props.field.kind === "inputFileIndexMapping" ? props.field.getIndex(props.model) : null,
    ] as const,
  () => {
    if (props.field.kind !== "inputFileIndexMapping") return;
    const idx = props.field.getIndex(props.model);
    inputFileIndexDraft.value =
      typeof idx === "number" && Number.isFinite(idx) && idx >= 0 ? String(Math.trunc(idx)) : "";
    inputFileIndexError.value = "";
  },
  { immediate: true },
);

const onInputFileIndexDraftUpdate = (value: unknown) => {
  if (props.field.kind !== "inputFileIndexMapping") return;
  const raw = String(value ?? "");
  inputFileIndexDraft.value = raw;
  const trimmed = raw.trim();
  if (!trimmed) {
    inputFileIndexError.value = t("presetEditor.fieldError.requiredInteger");
    return;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    inputFileIndexError.value = t("presetEditor.fieldError.invalidInteger");
    return;
  }
  if (n < 0) {
    inputFileIndexError.value = t("presetEditor.fieldError.minValue", { min: 0 });
    return;
  }
  inputFileIndexError.value = "";
  props.field.setIndex(props.model, Math.trunc(n));
};

const fixInputFileIndexDraft = () => {
  if (props.field.kind !== "inputFileIndexMapping") return;
  const fallback = props.field.defaultCustomIndex ?? 1;
  const next = Number.isFinite(fallback) && fallback >= 0 ? Math.trunc(fallback) : 1;
  props.field.setIndex(props.model, next);
  inputFileIndexDraft.value = String(next);
  inputFileIndexError.value = "";
};

const onInputFileIndexMappingUpdate = (value: unknown) => {
  if (props.field.kind !== "inputFileIndexMapping") return;
  const raw = value == null ? "" : String(value);
  if (!raw || raw === AUTO_VALUE) {
    props.field.setIndex(props.model, undefined);
    return;
  }
  if (raw === "-1") {
    props.field.setIndex(props.model, -1);
    return;
  }
  if (raw === "0") {
    props.field.setIndex(props.model, 0);
    return;
  }
  if (raw === CUSTOM_VALUE) {
    const current = props.field.getIndex(props.model);
    const next =
      typeof current === "number" && Number.isFinite(current) && current >= 0
        ? current
        : (props.field.defaultCustomIndex ?? 1);
    props.field.setIndex(props.model, next);
  }
};
</script>

<template>
  <div class="space-y-2">
    <Select
      :model-value="inputFileIndexMappingSelectValue"
      :disabled="isDisabled"
      @update:model-value="onInputFileIndexMappingUpdate"
    >
      <SelectTrigger
        class="h-9 text-xs"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      >
        <SelectValue>{{ labelFor(inputFileIndexMappingSelectValue) }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="AUTO_VALUE">{{ labelFor(AUTO_VALUE) }}</SelectItem>
        <SelectItem value="-1">{{ labelFor("-1") }}</SelectItem>
        <SelectItem v-if="field.kind === 'inputFileIndexMapping' && field.includeZero !== false" value="0">
          {{ labelFor("0") }}
        </SelectItem>
        <SelectItem :value="CUSTOM_VALUE">{{ labelFor(CUSTOM_VALUE) }}</SelectItem>
      </SelectContent>
    </Select>

    <Input
      v-if="inputFileIndexMappingSelectValue === CUSTOM_VALUE"
      :id="field.id"
      :model-value="inputFileIndexDraft"
      type="number"
      step="1"
      min="0"
      class="h-9 text-xs"
      :disabled="isDisabled"
      :class="inputFileIndexError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
      :data-command-group="commandGroupAttr"
      :data-command-field="commandFieldAttr"
      @update:model-value="onInputFileIndexDraftUpdate"
    />
    <div
      v-if="inputFileIndexMappingSelectValue === CUSTOM_VALUE && inputFileIndexError"
      class="flex items-center justify-between gap-2"
    >
      <p class="text-[10px] text-destructive">
        {{ inputFileIndexError }}
      </p>
      <Button type="button" variant="ghost" size="xs" class="h-6 px-2 text-[10px]" @click="fixInputFileIndexDraft">
        {{ t("presetEditor.fieldError.fix") }}
      </Button>
    </div>
  </div>
</template>
