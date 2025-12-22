<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { FFmpegPreset } from "@/types";
import {
  analyzeImportCommandLine,
  createCustomTemplatePresetFromAnalysis,
  type ImportCommandLineAnalysis,
} from "@/lib/presetCommandImport";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "importPresets", presets: FFmpegPreset[]): void;
}>();

const { t } = useI18n();

const inputText = ref<string>("");
const lines = computed(() => inputText.value.split(/\r?\n/));

const analyses = computed<ImportCommandLineAnalysis[]>(() => lines.value.map((line) => analyzeImportCommandLine(line)));

const included = ref<boolean[]>([]);
watch(
  lines,
  (nextLines, prevLines) => {
    const prev = included.value;
    const next: boolean[] = [];
    for (let i = 0; i < nextLines.length; i += 1) {
      const existing = prev[i];
      if (typeof existing === "boolean") {
        next.push(existing);
      } else {
        next.push(String(nextLines[i] ?? "").trim().length > 0);
      }
    }
    // When the user deletes lines, truncate the include array accordingly.
    if (prevLines && nextLines.length < prevLines.length) {
      next.length = nextLines.length;
    }
    included.value = next;
  },
  { immediate: true },
);

const includedCount = computed(() => included.value.filter(Boolean).length);

const structuredEligibleCount = computed(
  () => analyses.value.filter((a, idx) => included.value[idx] && a.eligibility.editable && !!a.structuredPreset).length,
);
const customEligibleCount = computed(
  () => analyses.value.filter((a, idx) => included.value[idx] && a.eligibility.custom && !!a.argsOnlyTemplate).length,
);

const importStructured = () => {
  const presetsToImport: FFmpegPreset[] = [];
  analyses.value.forEach((analysis, idx) => {
    if (!included.value[idx]) return;
    if (!analysis.eligibility.editable) return;
    if (!analysis.structuredPreset) return;
    const name = analysis.suggestedName?.trim() || analysis.structuredPreset.name || "Imported";
    presetsToImport.push({
      ...analysis.structuredPreset,
      name,
      description: "",
      advancedEnabled: false,
      ffmpegTemplate: undefined,
    });
  });
  if (presetsToImport.length === 0) return;
  emit("importPresets", presetsToImport);
  emit("update:open", false);
};

const importCustom = () => {
  const presetsToImport: FFmpegPreset[] = [];
  analyses.value.forEach((analysis, idx) => {
    if (!included.value[idx]) return;
    const preset = createCustomTemplatePresetFromAnalysis(analysis);
    if (!preset) return;
    preset.name = analysis.suggestedName?.trim() || preset.name || "Imported Command";
    presetsToImport.push(preset);
  });
  if (presetsToImport.length === 0) return;
  emit("importPresets", presetsToImport);
  emit("update:open", false);
};

const statusLabel = (analysis: ImportCommandLineAnalysis): string => {
  if (!analysis.trimmed) return t("presets.importCommandsStatusEmpty");
  if (analysis.eligibility.editable) return t("presets.importCommandsStatusEditable");
  if (analysis.eligibility.custom) return t("presets.importCommandsStatusCustom");
  return t("presets.importCommandsStatusBlocked");
};

const statusClass = (analysis: ImportCommandLineAnalysis): string => {
  if (!analysis.trimmed) return "text-muted-foreground";
  if (analysis.eligibility.editable) return "text-emerald-400";
  if (analysis.eligibility.custom) return "text-amber-400";
  return "text-destructive";
};
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
      <DialogHeader class="pb-2">
        <DialogTitle>{{ t("presets.importCommandsTitle") }}</DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          {{ t("presets.importCommandsDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 grid grid-cols-1 gap-3 overflow-hidden">
        <div class="grid grid-cols-1 gap-2">
          <Textarea
            v-model="inputText"
            class="min-h-[140px] font-mono text-[11px] leading-relaxed"
            :placeholder="t('presets.importCommandsPlaceholder')"
            data-testid="import-commands-textarea"
          />
          <div class="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{{ t("presets.importCommandsLinesSummary", { count: lines.length, included: includedCount }) }}</span>
            <span class="tabular-nums">
              {{
                t("presets.importCommandsEligibleSummary", {
                  editable: structuredEligibleCount,
                  custom: customEligibleCount,
                })
              }}
            </span>
          </div>
        </div>

        <div class="min-h-0 rounded-md border border-border/50 bg-card/50 overflow-hidden">
          <div class="px-3 py-2 border-b border-border/40 text-[11px] text-muted-foreground">
            {{ t("presets.importCommandsAnalysisTitle") }}
          </div>
          <div class="max-h-[40vh] overflow-y-auto">
            <div
              v-for="(analysis, idx) in analyses"
              :key="idx"
              class="px-3 py-2 border-b border-border/30 last:border-b-0 grid grid-cols-[24px,1fr] gap-3 items-start"
              data-testid="import-commands-row"
            >
              <Checkbox
                :checked="included[idx]"
                :disabled="!analysis.trimmed"
                class="mt-1"
                @update:checked="(v) => (included[idx] = !!v)"
              />

              <div class="min-w-0">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[11px] font-medium text-foreground truncate">
                      {{ analysis.suggestedName || t("presets.importCommandsUntitled") }}
                    </div>
                    <div class="text-[10px] text-muted-foreground truncate">
                      {{ analysis.normalizedTemplate || analysis.trimmed }}
                    </div>
                  </div>
                  <div class="flex-shrink-0 text-[10px] font-medium" :class="statusClass(analysis)">
                    {{ statusLabel(analysis) }}
                  </div>
                </div>

                <div class="mt-1 min-h-[16px] text-[10px] text-muted-foreground">
                  <span v-if="analysis.reasons.length > 0" class="line-clamp-2">
                    {{ analysis.reasons.join("；") }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="emit('update:open', false)">{{ t("app.actions.cancel") }}</Button>
        <Button variant="secondary" :disabled="structuredEligibleCount === 0" @click="importStructured">
          {{ t("presets.importAsEditable", { count: structuredEligibleCount }) }}
        </Button>
        <Button :disabled="customEligibleCount === 0" @click="importCustom">
          {{ t("presets.importAsCustom", { count: customEligibleCount }) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
