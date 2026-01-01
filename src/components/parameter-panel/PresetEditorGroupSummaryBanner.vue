<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import type { PresetEditorFix, PresetEditorGroup, PresetEditorIssue } from "@/lib/presetEditorContract/presetValidator";

const props = defineProps<{
  group: PresetEditorGroup;
  errors: number;
  warnings: number;
  issues: PresetEditorIssue[];
  fixes: PresetEditorFix[];
}>();

const emit = defineEmits<{
  (e: "fix"): void;
  (e: "fixOne", fixId: string): void;
  (e: "focus", payload: { group: PresetEditorGroup; field?: string }): void;
}>();

const { t } = useI18n();

const fixCount = computed(() => props.fixes.length);
const shouldShow = computed(() => props.errors > 0 || props.warnings > 0 || fixCount.value > 0);

const issueTitle = computed(() => t("presetEditor.validation.issuesTitle"));
const fixTitle = computed(() => t("presetEditor.validation.fixesTitle"));

const issueMessage = (issue: PresetEditorIssue) => {
  if (issue.messageParams) return t(issue.messageKey, issue.messageParams as any);
  return t(issue.messageKey);
};

const focus = (group: PresetEditorGroup, field?: string) => {
  emit("focus", { group, field });
};

const applyFix = (fixId: string) => {
  emit("fixOne", fixId);
};
</script>

<template>
  <div v-if="shouldShow" class="rounded-md border border-border/60 bg-muted/40 p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[11px] text-muted-foreground">
          {{
            t("presetEditor.validation.groupSummary", {
              errors: props.errors,
              warnings: props.warnings,
            })
          }}
        </p>
        <details class="mt-2">
          <summary class="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
            {{ t("presetEditor.validation.details") }}
          </summary>
          <div class="mt-2 space-y-3">
            <div v-if="props.issues.length > 0" class="space-y-1">
              <p class="text-[11px] font-semibold text-foreground/80">
                {{ issueTitle }}
              </p>
              <div class="max-h-44 overflow-y-auto space-y-1 pr-1">
                <div
                  v-for="(issue, idx) in props.issues"
                  :key="`${issue.group}-${issue.field ?? ''}-${issue.messageKey}-${idx}`"
                  class="flex items-start justify-between gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5"
                >
                  <div class="min-w-0">
                    <p class="text-[11px] text-foreground/90 break-words">
                      <span
                        class="mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        :class="
                          issue.level === 'error' ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-500'
                        "
                      >
                        {{
                          issue.level === "error"
                            ? t("presetEditor.validation.errorLabel")
                            : t("presetEditor.validation.warningLabel")
                        }}
                      </span>
                      {{ issueMessage(issue) }}
                    </p>
                  </div>
                  <div class="shrink-0 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-[11px]"
                      @click="focus(issue.group, issue.field)"
                    >
                      {{ t("presetEditor.validation.locate") }}
                    </Button>
                    <Button
                      v-if="issue.fixId"
                      type="button"
                      variant="secondary"
                      size="sm"
                      class="h-7 px-2 text-[11px]"
                      @click="applyFix(issue.fixId)"
                    >
                      {{ t("presetEditor.validation.applyFix") }}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="props.fixes.length > 0" class="space-y-1">
              <p class="text-[11px] font-semibold text-foreground/80">
                {{ fixTitle }}
              </p>
              <div class="max-h-44 overflow-y-auto space-y-1 pr-1">
                <div
                  v-for="fix in props.fixes"
                  :key="fix.id"
                  class="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5"
                >
                  <p class="text-[11px] text-foreground/90 min-w-0 break-words">
                    {{ t(fix.labelKey) }}
                  </p>
                  <div class="shrink-0 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-[11px]"
                      @click="focus(fix.group, fix.field)"
                    >
                      {{ t("presetEditor.validation.locate") }}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      class="h-7 px-2 text-[11px]"
                      @click="applyFix(fix.id)"
                    >
                      {{ t("presetEditor.validation.applyFix") }}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
      <Button
        v-if="fixCount > 0"
        type="button"
        variant="secondary"
        size="sm"
        class="h-7 px-2 text-[11px]"
        @click="emit('fix')"
      >
        {{ t("presetEditor.validation.fixGroup") }}
      </Button>
    </div>
  </div>
</template>
