<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

const presets = computed(() => (props.field.kind === "timeExpression" ? props.field.presets : []));

const timeExpressionSelectValue = computed<string>(() => {
  if (props.field.kind !== "timeExpression") return AUTO_VALUE;
  const v = props.field.getValue(props.model);
  if (!v) return AUTO_VALUE;
  if (props.field.presets.some((p) => p.value === v)) return v;
  return CUSTOM_VALUE;
});

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
    <Select
      :model-value="timeExpressionSelectValue"
      :disabled="isDisabled"
      @update:model-value="onTimeExpressionUpdate"
    >
      <SelectTrigger
        class="h-9 text-xs"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      >
        <SelectValue>{{ labelFor(timeExpressionSelectValue) }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="AUTO_VALUE">{{ labelFor(AUTO_VALUE) }}</SelectItem>
        <SelectItem v-for="p in presets" :key="p.value" :value="p.value">
          {{ labelFor(p.value) }}
        </SelectItem>
        <SelectItem :value="CUSTOM_VALUE">{{ labelFor(CUSTOM_VALUE) }}</SelectItem>
      </SelectContent>
    </Select>

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
