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

const quickTimes = computed(() => (props.field.kind === "loopCount" ? (props.field.quickTimes ?? []) : []));

const loopCountSelectValue = computed<string>(() => {
  if (props.field.kind !== "loopCount") return AUTO_VALUE;
  const cnt = props.field.getCount(props.model);
  if (typeof cnt !== "number" || !Number.isFinite(cnt)) return AUTO_VALUE;
  if (cnt === -1) return "-1";
  if (cnt === 0) return "0";
  return CUSTOM_VALUE;
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
    <Select :model-value="loopCountSelectValue" :disabled="isDisabled" @update:model-value="onLoopCountUpdate">
      <SelectTrigger
        class="h-9 text-xs"
        :data-testid="field.testId"
        :data-command-group="commandGroupAttr"
        :data-command-field="commandFieldAttr"
      >
        <SelectValue>{{ labelFor(loopCountSelectValue) }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="AUTO_VALUE">{{ labelFor(AUTO_VALUE) }}</SelectItem>
        <SelectItem value="0">{{ labelFor("0") }}</SelectItem>
        <SelectItem value="-1">{{ labelFor("-1") }}</SelectItem>
        <SelectItem v-for="times in quickTimes" :key="times" :value="String(times)">
          {{ labelFor(String(times)) }}
        </SelectItem>
        <SelectItem :value="CUSTOM_VALUE">{{ labelFor(CUSTOM_VALUE) }}</SelectItem>
      </SelectContent>
    </Select>

    <Input
      v-if="loopCountSelectValue === CUSTOM_VALUE"
      :id="field.id"
      :model-value="loopTimesDraft"
      type="number"
      step="1"
      min="1"
      class="h-9 text-xs"
      :disabled="isDisabled"
      :class="loopTimesError ? 'border-destructive focus-visible:ring-destructive/30' : ''"
      :data-command-group="commandGroupAttr"
      :data-command-field="commandFieldAttr"
      @update:model-value="onLoopTimesDraftUpdate"
    />
    <div v-if="loopCountSelectValue === CUSTOM_VALUE && loopTimesError" class="flex items-center justify-between gap-2">
      <p class="text-[10px] text-destructive">
        {{ loopTimesError }}
      </p>
      <Button type="button" variant="ghost" size="xs" class="h-6 px-2 text-[10px]" @click="fixLoopTimesDraft">
        {{ t("presetEditor.fieldError.fix") }}
      </Button>
    </div>
  </div>
</template>
