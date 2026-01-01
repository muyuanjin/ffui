<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Spinner } from "@/components/ui/spinner";
import type { PresetTemplateValidationResult } from "@/types";

const props = defineProps<{
  busy?: boolean;
  result?: PresetTemplateValidationResult | null;
  variant?: "inline" | "badge";
}>();

const { t } = useI18n();

const variant = computed(() => props.variant ?? "inline");
const outcome = computed(() => props.result?.outcome ?? null);

const label = computed(() => {
  if (props.busy) return t("presetEditor.advanced.quickValidate.running") as string;
  if (!outcome.value) return null;
  if (outcome.value === "ok") return t("presetEditor.advanced.quickValidate.ok") as string;
  if (outcome.value === "failed") return t("presetEditor.advanced.quickValidate.failed") as string;
  if (outcome.value === "timedOut") return t("presetEditor.advanced.quickValidate.timedOut") as string;
  if (outcome.value === "skippedToolUnavailable") return t("presetEditor.advanced.quickValidate.toolMissing") as string;
  if (outcome.value === "templateInvalid") return t("presetEditor.advanced.quickValidate.templateInvalid") as string;
  return t("presetEditor.advanced.quickValidate.failed") as string;
});

const toneClass = computed(() => {
  if (props.busy) return "text-muted-foreground";
  if (!outcome.value) return "text-muted-foreground";
  if (outcome.value === "ok") return "text-emerald-400";
  if (outcome.value === "skippedToolUnavailable" || outcome.value === "templateInvalid") return "text-amber-400";
  return "text-destructive";
});

const showDetails = computed(() => {
  if (variant.value === "badge") return false;
  if (props.busy) return false;
  if (!props.result) return false;
  if (props.result.outcome === "ok") return false;
  return Boolean(props.result.message || props.result.exitCode != null || props.result.stderrSummary);
});
</script>

<template>
  <div v-if="props.busy || props.result" data-testid="preset-template-validation-status">
    <div
      v-if="label"
      class="flex items-center gap-2 text-[11px]"
      :class="variant === 'badge' ? 'inline-flex px-2 py-0.5 rounded border border-border/60 bg-muted/30' : ''"
    >
      <Spinner v-if="props.busy" class="size-3" />
      <span class="font-medium" :class="toneClass">{{ label }}</span>
    </div>

    <div v-if="variant !== 'badge'" class="mt-1">
      <p v-if="props.result?.message" class="text-[11px] text-muted-foreground">
        {{ props.result.message }}
      </p>

      <details v-if="showDetails" class="mt-1 text-[11px] text-muted-foreground">
        <summary class="cursor-pointer select-none">
          {{ t("presetEditor.advanced.quickValidate.details") }}
        </summary>
        <div class="mt-2 space-y-2">
          <div v-if="props.result?.exitCode != null" class="tabular-nums">
            {{ t("presetEditor.advanced.quickValidate.exitCode", { code: props.result.exitCode }) }}
          </div>
          <pre
            v-if="props.result?.stderrSummary"
            class="whitespace-pre-wrap break-words rounded-md bg-background/80 border border-border/60 px-2 py-2 font-mono text-[10px]"
            >{{ props.result.stderrSummary }}</pre
          >
        </div>
      </details>
    </div>
  </div>
</template>
