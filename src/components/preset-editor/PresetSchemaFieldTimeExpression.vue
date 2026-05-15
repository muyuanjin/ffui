<script setup lang="ts">
import { computed } from "vue";
import { Input } from "@/components/ui/input";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";
import { CUSTOM_VALUE } from "./presetSchemaFieldLabels";
import PresetSchemaFieldSelect from "./PresetSchemaFieldSelect.vue";
import { usePresetSchemaFieldLabel, type PresetSchemaFieldComponentProps } from "./presetSchemaFieldShared";

const props = defineProps<PresetSchemaFieldComponentProps>();

const { t, labelFor } = usePresetSchemaFieldLabel(props);

const presets = computed(() => (props.field.kind === "timeExpression" ? props.field.presets : []));

const timeExpressionSelectValue = computed<string>(() => {
  if (props.field.kind !== "timeExpression") return AUTO_VALUE;
  const v = props.field.getValue(props.model);
  if (!v) return AUTO_VALUE;
  if (props.field.presets.some((p) => p.value === v)) return v;
  return CUSTOM_VALUE;
});

const timeExpressionSelectOptions = computed(() => [
  { value: AUTO_VALUE, label: labelFor(AUTO_VALUE) },
  ...presets.value.map((p) => ({ value: p.value, label: labelFor(p.value) })),
  { value: CUSTOM_VALUE, label: labelFor(CUSTOM_VALUE) },
]);

const timeExpressionInputValue = computed<string>({
  get() {
    if (props.field.kind !== "timeExpression") return "";
    return props.field.getValue(props.model) ?? "";
  },
  set(value) {
    if (props.field.kind !== "timeExpression") return;
    const v = String(value ?? "").trim();
    props.field.setValue(props.model, v ? v : undefined);
  },
});

const onTimeExpressionUpdate = (value: unknown) => {
  if (props.field.kind !== "timeExpression") return;
  const raw = value == null ? "" : String(value);
  if (!raw || raw === AUTO_VALUE) {
    props.field.setValue(props.model, undefined);
    return;
  }
  if (raw === CUSTOM_VALUE) {
    const current = props.field.getValue(props.model);
    props.field.setValue(
      props.model,
      current && current.trim().length > 0 ? current : (props.field.defaultCustomValue ?? "0"),
    );
    return;
  }
  props.field.setValue(props.model, raw);
};
</script>

<template>
  <div class="space-y-2">
    <PresetSchemaFieldSelect
      :model-value="timeExpressionSelectValue"
      :disabled="isDisabled"
      :trigger-label="labelFor(timeExpressionSelectValue)"
      :options="timeExpressionSelectOptions"
      :test-id="field.testId"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
      @update:model-value="onTimeExpressionUpdate"
    />

    <Input
      v-if="timeExpressionSelectValue === CUSTOM_VALUE"
      :id="field.id"
      v-model="timeExpressionInputValue"
      :placeholder="field.placeholderKey ? t(field.placeholderKey) : ''"
      class="h-9 text-xs font-mono"
      :disabled="isDisabled"
      :data-command-group="commandGroupAttr"
      :data-command-field="commandFieldAttr"
    />
  </div>
</template>
