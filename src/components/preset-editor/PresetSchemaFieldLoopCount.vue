<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";
import { CUSTOM_VALUE } from "./presetSchemaFieldLabels";
import PresetSchemaFieldSelect from "./PresetSchemaFieldSelect.vue";
import PresetSchemaIntegerCustomInput from "./PresetSchemaIntegerCustomInput.vue";
import { usePresetSchemaFieldLabel, type PresetSchemaFieldComponentProps } from "./presetSchemaFieldShared";

const props = defineProps<PresetSchemaFieldComponentProps>();

const { t, labelFor } = usePresetSchemaFieldLabel(props);

const quickTimes = computed(() => (props.field.kind === "loopCount" ? (props.field.quickTimes ?? []) : []));

const loopCountSelectValue = computed<string>(() => {
  if (props.field.kind !== "loopCount") return AUTO_VALUE;
  const cnt = props.field.getCount(props.model);
  if (typeof cnt !== "number" || !Number.isFinite(cnt)) return AUTO_VALUE;
  if (cnt === -1) return "-1";
  if (cnt === 0) return "0";
  return CUSTOM_VALUE;
});

const loopCountSelectOptions = computed(() => {
  const options = [
    { value: AUTO_VALUE, label: labelFor(AUTO_VALUE) },
    { value: "0", label: labelFor("0") },
    { value: "-1", label: labelFor("-1") },
  ];
  for (const times of quickTimes.value) {
    options.push({ value: String(times), label: labelFor(String(times)) });
  }
  options.push({ value: CUSTOM_VALUE, label: labelFor(CUSTOM_VALUE) });
  return options;
});

const loopTimesDraft = ref<string>("");
const loopTimesError = ref<string>("");
watch(
  () =>
    [
      props.field.id,
      props.field.kind,
      props.field.kind === "loopCount" ? props.field.getCount(props.model) : null,
    ] as const,
  () => {
    if (props.field.kind !== "loopCount") return;
    const cnt = props.field.getCount(props.model);
    loopTimesDraft.value = typeof cnt === "number" && Number.isFinite(cnt) && cnt > 0 ? String(Math.trunc(cnt)) : "";
    loopTimesError.value = "";
  },
  { immediate: true },
);

const onLoopTimesDraftUpdate = (value: unknown) => {
  if (props.field.kind !== "loopCount") return;
  const raw = String(value ?? "");
  loopTimesDraft.value = raw;
  const trimmed = raw.trim();
  if (!trimmed) {
    loopTimesError.value = t("presetEditor.fieldError.requiredInteger");
    return;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    loopTimesError.value = t("presetEditor.fieldError.invalidInteger");
    return;
  }
  if (n <= 0) {
    loopTimesError.value = t("presetEditor.fieldError.minValue", { min: 1 });
    return;
  }
  loopTimesError.value = "";
  props.field.setCount(props.model, Math.trunc(n));
};

const fixLoopTimesDraft = () => {
  if (props.field.kind !== "loopCount") return;
  const fallback = props.field.defaultTimes ?? 1;
  const next = Number.isFinite(fallback) && fallback > 0 ? Math.trunc(fallback) : 1;
  props.field.setCount(props.model, next);
  loopTimesDraft.value = String(next);
  loopTimesError.value = "";
};

const onLoopCountUpdate = (value: unknown) => {
  if (props.field.kind !== "loopCount") return;
  const raw = value == null ? "" : String(value);
  if (!raw || raw === AUTO_VALUE) {
    props.field.setCount(props.model, undefined);
    return;
  }
  if (raw === "-1") {
    props.field.setCount(props.model, -1);
    return;
  }
  if (raw === "0") {
    props.field.setCount(props.model, 0);
    return;
  }
  if (raw === CUSTOM_VALUE) {
    const current = props.field.getCount(props.model);
    const next =
      typeof current === "number" && Number.isFinite(current) && current > 0
        ? current
        : (props.field.defaultTimes ?? 1);
    props.field.setCount(props.model, next);
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    props.field.setCount(props.model, Math.trunc(n));
  }
};
</script>

<template>
  <div class="space-y-2">
    <PresetSchemaFieldSelect
      :model-value="loopCountSelectValue"
      :disabled="isDisabled"
      :trigger-label="labelFor(loopCountSelectValue)"
      :options="loopCountSelectOptions"
      :test-id="field.testId"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
      @update:model-value="onLoopCountUpdate"
    />

    <PresetSchemaIntegerCustomInput
      v-if="loopCountSelectValue === CUSTOM_VALUE"
      :id="field.id"
      :model-value="loopTimesDraft"
      :min="1"
      :disabled="isDisabled"
      :error="loopTimesError"
      :command-group-attr="commandGroupAttr"
      :command-field-attr="commandFieldAttr"
      :fix-label="t('presetEditor.fieldError.fix')"
      @update:model-value="onLoopTimesDraftUpdate"
      @fix="fixLoopTimesDraft"
    />
  </div>
</template>
