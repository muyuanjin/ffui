<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { NumberFieldDef } from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  field: NumberFieldDef<any>;
  model: any;
  isDisabled: boolean;
  commandGroupAttr?: string;
  commandFieldAttr?: string;
}>();

const { t } = useI18n();

const numberDraft = ref<string>("");
const numberError = ref<string>("");

watch(
  () =>
    [
      props.field.id,
      props.field.kind,
      props.field.kind === "number" ? props.field.getValue(props.model) : null,
    ] as const,
  () => {
    if (props.field.kind !== "number") return;
    const v = props.field.getValue(props.model);
    numberDraft.value = typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    numberError.value = "";
  },
  { immediate: true },
);

const clampToRange = () => {
  if (props.field.kind !== "number") return;
  const min = typeof props.field.min === "number" ? props.field.min : undefined;
  const max = typeof props.field.max === "number" ? props.field.max : undefined;
  const current = Number(numberDraft.value);
  if (!Number.isFinite(current)) return;
  let next = current;
  if (min != null && next < min) next = min;
  if (max != null && next > max) next = max;
  props.field.setValue(props.model, next);
  numberDraft.value = String(next);
  numberError.value = "";
};

const onNumberInputUpdate = (value: unknown) => {
  if (props.field.kind !== "number") return;
  const raw = String(value ?? "");
  numberDraft.value = raw;

  const trimmed = raw.trim();
  if (!trimmed) {
    numberError.value = "";
    props.field.setValue(props.model, undefined);
    return;
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    numberError.value = t("presetEditor.fieldError.invalidNumber");
    return;
  }
  if (typeof props.field.min === "number" && n < props.field.min) {
    numberError.value = t("presetEditor.fieldError.minValue", { min: props.field.min });
    return;
  }
  if (typeof props.field.max === "number" && n > props.field.max) {
    numberError.value = t("presetEditor.fieldError.maxValue", { max: props.field.max });
    return;
  }
  numberError.value = "";
  props.field.setValue(props.model, n);
};
</script>

<template>
  <div class="space-y-2">
    <Input
      :id="field.id"
      :model-value="numberDraft"
      type="number"
      :min="typeof field.min === 'number' ? String(field.min) : undefined"
      :max="typeof field.max === 'number' ? String(field.max) : undefined"
      :step="typeof field.step === 'number' ? String(field.step) : '1'"
      :placeholder="field.placeholderKey ? (t(field.placeholderKey) as string) : ''"
      class="h-9 text-xs"
      :class="numberError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
      :disabled="isDisabled"
      :data-testid="field.testId"
      :data-command-group="commandGroupAttr"
      :data-command-field="commandFieldAttr"
      @update:model-value="onNumberInputUpdate"
    />
    <div v-if="numberError" class="flex items-center justify-between gap-2">
      <p class="text-[10px] text-destructive">
        {{ numberError }}
      </p>
      <Button
        v-if="typeof field.min === 'number' || typeof field.max === 'number'"
        type="button"
        variant="ghost"
        size="xs"
        class="h-6 px-2 text-[10px]"
        @click="clampToRange"
      >
        {{ t("presetEditor.fieldError.fix") }}
      </Button>
    </div>
  </div>
</template>
