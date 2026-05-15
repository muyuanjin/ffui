<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";
import { CUSTOM_VALUE } from "./presetSchemaFieldLabels";
import PresetSchemaFieldSelect from "./PresetSchemaFieldSelect.vue";
import PresetSchemaIntegerCustomInput from "./PresetSchemaIntegerCustomInput.vue";
import { usePresetSchemaFieldLabel, type PresetSchemaFieldComponentProps } from "./presetSchemaFieldShared";

const props = defineProps<PresetSchemaFieldComponentProps>();

const { t, labelFor } = usePresetSchemaFieldLabel(props);

const inputFileIndexMappingSelectValue = computed<string>(() => {
  if (props.field.kind !== "inputFileIndexMapping") return AUTO_VALUE;
  const idx = props.field.getIndex(props.model);
  if (typeof idx !== "number" || !Number.isFinite(idx)) return AUTO_VALUE;
  if (idx === -1) return "-1";
  if (idx === 0) return "0";
  return CUSTOM_VALUE;
});

const inputFileIndexMappingSelectOptions = computed(() => {
  const options = [
    { value: AUTO_VALUE, label: labelFor(AUTO_VALUE) },
    { value: "-1", label: labelFor("-1") },
  ];
  if (props.field.kind === "inputFileIndexMapping" && props.field.includeZero !== false) {
    options.push({ value: "0", label: labelFor("0") });
  }
  options.push({ value: CUSTOM_VALUE, label: labelFor(CUSTOM_VALUE) });
  return options;
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
    <PresetSchemaFieldSelect
      :model-value="inputFileIndexMappingSelectValue"
      :disabled="isDisabled"
      :trigger-label="labelFor(inputFileIndexMappingSelectValue)"
      :options="inputFileIndexMappingSelectOptions"
      :test-id="field.testId"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
      @update:model-value="onInputFileIndexMappingUpdate"
    />

    <PresetSchemaIntegerCustomInput
      v-if="inputFileIndexMappingSelectValue === CUSTOM_VALUE"
      :id="field.id"
      :model-value="inputFileIndexDraft"
      :min="0"
      :disabled="isDisabled"
      :error="inputFileIndexError"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
      :fix-label="t('presetEditor.fieldError.fix')"
      @update:model-value="onInputFileIndexDraftUpdate"
      @fix="fixInputFileIndexDraft"
    />
  </div>
</template>
