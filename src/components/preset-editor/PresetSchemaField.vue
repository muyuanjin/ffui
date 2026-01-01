<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";
import type { PresetFieldDef } from "@/lib/presetEditorContract/parameterSchema";
import PresetSchemaFieldNumber from "@/components/preset-editor/PresetSchemaFieldNumber.vue";
import PresetSchemaFieldInputFileIndexMapping from "@/components/preset-editor/PresetSchemaFieldInputFileIndexMapping.vue";
import PresetSchemaFieldLoopCount from "@/components/preset-editor/PresetSchemaFieldLoopCount.vue";
import PresetSchemaFieldTimeExpression from "@/components/preset-editor/PresetSchemaFieldTimeExpression.vue";
import { selectItemLabelForField } from "@/components/preset-editor/presetSchemaFieldLabels";

const props = defineProps<{
  field: PresetFieldDef<any>;
  model: any;
  /** Tab-level command group id (for token↔field navigation). */
  commandGroup?: string;
}>();

const { t } = useI18n();

const isVisible = computed(() => (props.field.visibleWhen ? props.field.visibleWhen(props.model) : true));
const isDisabled = computed(() => (props.field.disabledWhen ? props.field.disabledWhen(props.model) : false));
const disabledReasonText = computed(() => {
  const custom = props.field.disabledReason?.(props.model);
  if (custom && custom.trim().length > 0) return custom;
  if (props.field.disabledReasonKey) return t(props.field.disabledReasonKey);
  return "";
});

const fieldWidthClass = computed(() => (props.field.width === "half" ? "sm:col-span-1" : "sm:col-span-2"));

const labelText = computed(() => t(props.field.labelKey));
const helpText = computed(() => (props.field.helpKey ? t(props.field.helpKey) : ""));
const descriptionText = computed(() => (props.field.descriptionKey ? t(props.field.descriptionKey) : ""));
const unitText = computed(() => {
  if (props.field.unitKey) return t(props.field.unitKey);
  return String(props.field.unit ?? "");
});
const recommendedHint = computed(() => {
  const rec = props.field.recommended?.(props.model) ?? null;
  if (!rec) return "";
  if (rec.labelKey) return t(rec.labelKey);
  const unit = unitText.value ? ` ${unitText.value}` : "";
  return String(rec.value) + unit;
});

const commandGroupAttr = computed(() => props.commandGroup);
const commandFieldAttr = computed(() => props.field.commandField);

const rangeHintText = computed(() => {
  if (props.field.kind !== "number") return "";
  const min = typeof props.field.min === "number" ? props.field.min : undefined;
  const max = typeof props.field.max === "number" ? props.field.max : undefined;
  if (min == null && max == null && !unitText.value) return "";
  const unit = unitText.value ? ` ${unitText.value}` : "";
  if (min != null && max != null) return t("presetEditor.fieldMeta.rangeMinMax", { min, max, unit });
  if (min != null) return t("presetEditor.fieldMeta.rangeMinOnly", { min, unit });
  if (max != null) return t("presetEditor.fieldMeta.rangeMaxOnly", { max, unit });
  return unitText.value ? t("presetEditor.fieldMeta.unitOnly", { unit: unitText.value }) : "";
});

const selectItemLabel = (value: string) => selectItemLabelForField(props.field, props.model, value, t);

const enumSelectValue = computed<string>(() => {
  if (props.field.kind !== "enum") return AUTO_VALUE;
  const v = props.field.getValue(props.model);
  if (props.field.allowUnset) return v && v.trim().length > 0 ? v : AUTO_VALUE;
  const normalized = v && v.trim().length > 0 ? v : "";
  if (normalized) return normalized;
  return props.field.options[0]?.value ?? AUTO_VALUE;
});

const stringFieldValue = computed<string>({
  get() {
    if (props.field.kind !== "string") return "";
    return props.field.getValue(props.model) ?? "";
  },
  set(value) {
    if (props.field.kind !== "string") return;
    const raw = String(value ?? "");
    const next = props.field.trim === false ? raw : raw.trim();
    props.field.setValue(props.model, next.length > 0 ? next : undefined);
  },
});

const textFieldValue = computed<string>({
  get() {
    if (props.field.kind !== "text") return "";
    return props.field.getValue(props.model) ?? "";
  },
  set(value) {
    if (props.field.kind !== "text") return;
    const raw = String(value ?? "");
    const next = props.field.trim === false ? raw : raw.trim();
    props.field.setValue(props.model, next.length > 0 ? next : undefined);
  },
});

const stringListTextValue = computed<string>({
  get() {
    if (props.field.kind !== "stringList") return "";
    const v = props.field.getValue(props.model);
    return Array.isArray(v) && v.length > 0 ? v.join(props.field.joiner) : "";
  },
  set(value) {
    if (props.field.kind !== "stringList") return;
    const text = String(value ?? "");
    const splitter = new RegExp(props.field.splitter, "g");
    const parts = text
      .split(splitter)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    props.field.setValue(props.model, parts.length > 0 ? parts : undefined);
  },
});

const stringLinesTextValue = computed<string>({
  get() {
    if (props.field.kind !== "stringLines") return "";
    const v = props.field.getValue(props.model);
    return Array.isArray(v) && v.length > 0 ? v.join("\n") : "";
  },
  set(value) {
    if (props.field.kind !== "stringLines") return;
    const text = String(value ?? "");
    const lines = text
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    props.field.setValue(props.model, lines.length > 0 ? lines : undefined);
  },
});

const onEnumUpdate = (value: unknown) => {
  if (props.field.kind !== "enum") return;
  const raw = value == null ? "" : String(value);
  if (!raw || raw === AUTO_VALUE) {
    props.field.setValue(props.model, undefined);
    return;
  }
  props.field.setValue(props.model, raw);
};
</script>

<template>
  <div v-if="isVisible" :class="fieldWidthClass">
    <div class="flex items-center gap-1">
      <Label class="text-[10px] mb-1 block" :for="field.id">
        {{ labelText }}
      </Label>
      <HelpTooltipIcon v-if="helpText" :text="helpText" />
    </div>

    <div v-if="field.kind === 'enum'" class="space-y-2">
      <Select :model-value="enumSelectValue" :disabled="isDisabled" @update:model-value="onEnumUpdate">
        <SelectTrigger
          class="h-9 text-xs"
          :data-testid="field.testId"
          :data-command-group="commandGroupAttr"
          :data-command-field="commandFieldAttr"
        >
          <SelectValue>{{ selectItemLabel(enumSelectValue) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-if="field.allowUnset" :value="AUTO_VALUE">{{ selectItemLabel(AUTO_VALUE) }}</SelectItem>
          <SelectItem v-for="opt in field.options" :key="opt.value" :value="opt.value">
            {{ selectItemLabel(opt.value) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-else-if="field.kind === 'string'" class="space-y-2">
      <Input
        :id="field.id"
        v-model="stringFieldValue"
        :placeholder="field.placeholderKey ? (t(field.placeholderKey) as string) : ''"
        class="h-9 text-xs"
        :class="field.mono ? 'font-mono' : ''"
        :disabled="isDisabled"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      />
    </div>

    <div v-else-if="field.kind === 'text'" class="space-y-2">
      <Textarea
        :id="field.id"
        v-model="textFieldValue"
        :placeholder="field.placeholderKey ? (t(field.placeholderKey) as string) : ''"
        class="text-[11px]"
        :class="field.mono ? 'font-mono' : ''"
        :rows="field.minRows ?? 4"
        :disabled="isDisabled"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      />
    </div>

    <PresetSchemaFieldNumber
      v-else-if="field.kind === 'number'"
      :field="field"
      :model="model"
      :is-disabled="isDisabled"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
    />

    <div v-else-if="field.kind === 'stringList'" class="space-y-2">
      <Input
        :id="field.id"
        v-model="stringListTextValue"
        :placeholder="field.placeholderKey ? (t(field.placeholderKey) as string) : ''"
        class="h-9 text-xs"
        :class="field.mono ? 'font-mono' : ''"
        :disabled="isDisabled"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      />
    </div>

    <div v-else-if="field.kind === 'stringLines'" class="space-y-2">
      <Textarea
        :id="field.id"
        v-model="stringLinesTextValue"
        :placeholder="field.placeholderKey ? (t(field.placeholderKey) as string) : ''"
        class="text-[11px]"
        :class="field.mono ? 'font-mono' : ''"
        :rows="field.minRows ?? 3"
        :disabled="isDisabled"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      />
    </div>

    <PresetSchemaFieldInputFileIndexMapping
      v-else-if="field.kind === 'inputFileIndexMapping'"
      :field="field"
      :model="model"
      :is-disabled="isDisabled"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
    />

    <PresetSchemaFieldLoopCount
      v-else-if="field.kind === 'loopCount'"
      :field="field"
      :model="model"
      :is-disabled="isDisabled"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
    />

    <PresetSchemaFieldTimeExpression
      v-else-if="field.kind === 'timeExpression'"
      :field="field"
      :model="model"
      :is-disabled="isDisabled"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
    />

    <div
      v-if="recommendedHint || rangeHintText || (isDisabled && disabledReasonText) || descriptionText"
      class="mt-1 space-y-1"
    >
      <p v-if="recommendedHint" class="text-[10px] text-emerald-300">
        <span class="font-medium text-emerald-200">{{ t("presetEditor.fieldMeta.recommendedLabel") }}:</span>
        <span class="ml-1">{{ recommendedHint }}</span>
      </p>
      <p v-if="rangeHintText" class="text-[10px] text-muted-foreground">
        {{ rangeHintText }}
      </p>
      <p v-if="isDisabled && disabledReasonText" class="text-[10px] text-muted-foreground">
        {{ disabledReasonText }}
      </p>
      <p v-if="descriptionText" class="text-[11px] text-muted-foreground">
        {{ descriptionText }}
      </p>
    </div>
  </div>
</template>
