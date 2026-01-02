<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FFmpegPreset, PresetTemplateValidationResult } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useI18n } from "vue-i18n";
import { validatePresetTemplate } from "@/lib/backend";
import { usePresetEditor } from "@/composables";
import { computePresetInsights } from "@/lib/presetInsights";
import { validatePresetEditorState, type PresetEditorGroup } from "@/lib/presetEditorContract/presetValidator";
import PresetGlobalTab from "@/components/preset-editor/PresetGlobalTab.vue";
import PresetInputTab from "@/components/preset-editor/PresetInputTab.vue";
import PresetMappingTab from "@/components/preset-editor/PresetMappingTab.vue";
import PresetVideoTab from "@/components/preset-editor/PresetVideoTab.vue";
import PresetAudioTab from "@/components/preset-editor/PresetAudioTab.vue";
import PresetFiltersTab from "@/components/preset-editor/PresetFiltersTab.vue";
import PresetContainerTab from "@/components/preset-editor/PresetContainerTab.vue";
import PresetHardwareTab from "@/components/preset-editor/PresetHardwareTab.vue";
import UltimateParameterPanelPreviewPane from "@/components/parameter-panel/UltimateParameterPanelPreviewPane.vue";
import UltimateParameterPanelSidebar from "@/components/parameter-panel/UltimateParameterPanelSidebar.vue";
import PresetEditorGroupSummaryBanner from "@/components/parameter-panel/PresetEditorGroupSummaryBanner.vue";
import PresetTemplateValidationStatus from "@/components/preset-template/PresetTemplateValidationStatus.vue";

const props = defineProps<{
  /** Preset being edited in the full parameter panel. */
  initialPreset: FFmpegPreset;
  /** All presets for cross-preset calibration (best-effort). */
  presets?: FFmpegPreset[];
}>();

const emit = defineEmits<{
  (e: "save", value: FFmpegPreset): void;
  (e: "cancel"): void;
  // Allow jumping back to the guided wizard while keeping the edited state.
  (e: "switchToWizard", value: FFmpegPreset): void;
}>();

const { t } = useI18n();

const initialCustomCommandPreset = Boolean(
  props.initialPreset.advancedEnabled && (props.initialPreset.ffmpegTemplate ?? "").trim().length > 0,
);
const activeTab = ref<
  "command" | "global" | "input" | "mapping" | "video" | "audio" | "filters" | "container" | "hardware"
>(initialCustomCommandPreset ? "command" : "video");

// Use preset editor composable
const {
  name,
  description,
  global: globalConfig,
  input: inputTimeline,
  mapping,
  video,
  audio,
  filters,
  subtitles,
  container,
  hardware,
  advancedEnabled,
  ffmpegTemplate,
  parseHint,
  isCopyEncoder,
  rateControlLabel,
  commandPreview,
  highlightedCommandTokens,
  parseHintClass,
  buildPresetFromState,
  handleParseTemplateFromCommand,
} = usePresetEditor({ initialPreset: props.initialPreset, t });

const isCustomCommandPreset = computed<boolean>(() => advancedEnabled.value && ffmpegTemplate.value.trim().length > 0);
watch(isCustomCommandPreset, (isCustom) => {
  if (isCustom) activeTab.value = "command";
});

const quickValidateBusy = ref(false);
const quickValidateResult = ref<PresetTemplateValidationResult | null>(null);
watch([advancedEnabled, ffmpegTemplate], () => {
  quickValidateResult.value = null;
});

const quickValidateHover = ref(false);
const quickValidateButtonLabel = computed(() => {
  if (quickValidateHover.value) return t("presetEditor.advanced.quickValidateButton") as string;
  if (quickValidateBusy.value) return t("presetEditor.advanced.quickValidate.running") as string;

  const outcome = quickValidateResult.value?.outcome ?? null;
  if (!outcome) return t("presetEditor.advanced.quickValidateButton") as string;
  if (outcome === "ok") return t("presetEditor.advanced.quickValidate.ok") as string;
  if (outcome === "failed") return t("presetEditor.advanced.quickValidate.failed") as string;
  if (outcome === "timedOut") return t("presetEditor.advanced.quickValidate.timedOut") as string;
  if (outcome === "skippedToolUnavailable") return t("presetEditor.advanced.quickValidate.toolMissing") as string;
  if (outcome === "templateInvalid") return t("presetEditor.advanced.quickValidate.templateInvalid") as string;
  return t("presetEditor.advanced.quickValidate.failed") as string;
});

const quickValidateButtonToneClass = computed(() => {
  if (quickValidateHover.value) return "";
  if (quickValidateBusy.value) return "";
  const outcome = quickValidateResult.value?.outcome ?? null;
  if (!outcome) return "";
  if (outcome === "ok") return "text-emerald-400";
  if (outcome === "skippedToolUnavailable" || outcome === "templateInvalid") return "text-amber-400";
  return "text-destructive";
});

// name 和 description 现在在模板中直接使用，用于编辑预设名称和描述

const handleSave = () => {
  emit("save", buildPresetFromState());
};

const handleSwitchToWizard = () => {
  emit("switchToWizard", buildPresetFromState());
};

// 基于当前编辑状态构建洞察数据（雷达图 + 用途标签等）
const currentPresetSnapshot = computed<FFmpegPreset>(() => buildPresetFromState());
const currentInsights = computed(() => computePresetInsights(currentPresetSnapshot.value));

const validationState = {
  global: globalConfig,
  input: inputTimeline,
  mapping,
  video,
  audio,
  filters,
  subtitles,
  container,
  hardware,
  advancedEnabled,
  ffmpegTemplate,
};
const validation = computed(() => validatePresetEditorState(validationState as any));
const groupSummary = computed(() => validation.value.byGroup);
const activeGroup = computed(() => activeTab.value as PresetEditorGroup);
const activeGroupSummary = computed(() => groupSummary.value[activeGroup.value]);
const activeGroupIssues = computed(() => validation.value.issues.filter((i) => i.group === activeGroup.value));
const activeGroupFixes = computed(() => groupSummary.value[activeGroup.value]?.fixes ?? []);
const applyActiveGroupFixes = () => applyGroupFixes(activeGroup.value);

const applyGroupFixes = (group: PresetEditorGroup) => {
  const fixes = groupSummary.value[group]?.fixes ?? [];
  for (const fix of fixes) {
    fix.apply(validationState as any);
  }
};
const applyFixById = (fixId: string) => {
  const fix = activeGroupFixes.value.find((f) => f.id === fixId) ?? validation.value.fixes.find((f) => f.id === fixId);
  if (!fix) return;
  fix.apply(validationState as any);
};

const focusedTarget = ref<{ group: string; field?: string } | null>(null);

const isTokenFocused = (token: any) => {
  const target = focusedTarget.value;
  if (!target) return false;
  const group = String(token?.group ?? "");
  if (!group || group !== target.group) return false;
  const field = String(token?.field ?? "");
  if (!target.field) return true;
  return field === target.field;
};

const cssEscape = (value: string) => {
  const fn = (globalThis as any).CSS?.escape;
  if (typeof fn === "function") return fn(value);
  return String(value).replace(/"/g, '\\"');
};

const focusEditorField = async (group: string, field?: string) => {
  const nextGroup = group as any;
  if (nextGroup) activeTab.value = nextGroup;
  await nextTick();

  const preferred = field
    ? `[data-command-group="${cssEscape(group)}"][data-command-field="${cssEscape(field)}"]`
    : null;
  const fallback = `[data-command-group="${cssEscape(group)}"]`;

  const el =
    (preferred ? (document.querySelector(preferred) as HTMLElement | null) : null) ??
    (document.querySelector(fallback) as HTMLElement | null);
  if (el) {
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center" });
    }
    if (typeof (el as any).focus === "function") (el as any).focus();
  }
};
const onValidationFocus = async (payload: { group: string; field?: string }) => {
  focusedTarget.value = { group: payload.group, field: payload.field };
  await focusEditorField(payload.group, payload.field);
};

const onPreviewTokenClick = async (token: any) => {
  const group = String(token?.group ?? "").trim();
  if (!group) return;
  const field = String(token?.field ?? "").trim() || undefined;
  focusedTarget.value = { group, field };
  await focusEditorField(group, field);
};

const onEditorFocusIn = (event: FocusEvent) => {
  const raw = event.target as HTMLElement | null;
  const el = raw?.closest?.("[data-command-group]") as HTMLElement | null;
  if (!el) return;
  const group = el.dataset.commandGroup;
  const field = el.dataset.commandField;
  if (!group) return;
  focusedTarget.value = { group, field: field || undefined };
};

const copyHint = ref<string | null>(null);
let copyHintTimer: number | null = null;
const setCopyHint = (msg: string) => {
  copyHint.value = msg;
  if (copyHintTimer != null) window.clearTimeout(copyHintTimer);
  copyHintTimer = window.setTimeout(() => {
    copyHint.value = null;
  }, 1500);
};
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    setCopyHint(t("presetEditor.advanced.copiedToast"));
  } catch {
    setCopyHint(t("presetEditor.advanced.copyFailedToast"));
  }
};
const handleCopyCommand = async () => {
  await copyToClipboard(commandPreview.value);
};
const handleCopyTemplate = async () => {
  const tpl = ffmpegTemplate.value.trim();
  if (!tpl) return;
  await copyToClipboard(tpl);
};

const handleQuickValidate = async () => {
  if (quickValidateBusy.value) return;
  if (!isCustomCommandPreset.value) return;
  quickValidateBusy.value = true;
  try {
    quickValidateResult.value = await validatePresetTemplate(buildPresetFromState());
  } finally {
    quickValidateBusy.value = false;
  }
};
</script>

<template>
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div
      class="bg-background w-full max-w-5xl rounded-xl shadow-2xl border border-border flex flex-col h-[min(820px,92vh)]"
      data-ffui-parameter-panel="root"
    >
      <div class="p-6 border-b border-border">
        <div class="flex justify-between items-start gap-4">
          <!-- 左侧：可编辑的名称和描述 -->
          <div class="flex-1 min-w-0 space-y-2">
            <div class="flex items-center gap-3">
              <Label class="text-xs text-muted-foreground whitespace-nowrap w-12">
                {{ t("presetEditor.nameLabel") }}
              </Label>
              <Input
                v-model="name"
                :placeholder="t('presetEditor.namePlaceholder')"
                class="h-8 text-base font-semibold flex-1"
              />
            </div>
            <div class="flex items-center gap-3">
              <Label class="text-xs text-muted-foreground whitespace-nowrap w-12">
                {{ t("presetEditor.descriptionLabel") }}
              </Label>
              <Input
                v-model="description"
                :placeholder="t('presetEditor.descriptionPlaceholder')"
                class="h-8 text-xs flex-1"
              />
            </div>
          </div>
          <!-- 右侧：操作按钮 -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" class="h-8 px-3 text-[11px]" @click="handleSwitchToWizard">
              {{ t("presetEditor.actions.backToWizard") }}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-foreground"
              data-testid="preset-editor-close"
              @click="emit('cancel')"
            >
              ✕
            </Button>
          </div>
        </div>
        <p class="text-muted-foreground text-xs mt-3">
          {{ t("presetEditor.panel.subtitle") }}
        </p>
      </div>

      <Tabs v-model="activeTab" class="flex-1 flex min-h-0">
        <UltimateParameterPanelSidebar
          :group-summary="groupSummary"
          :is-custom-command-preset="isCustomCommandPreset"
        />

        <div class="flex-1 flex min-h-0">
          <div class="flex-1 p-6 overflow-y-auto space-y-4" @focusin.capture="onEditorFocusIn">
            <PresetEditorGroupSummaryBanner
              :group="activeGroup"
              :errors="activeGroupSummary.errors"
              :warnings="activeGroupSummary.warnings"
              :issues="activeGroupIssues"
              :fixes="activeGroupFixes"
              @fix="applyActiveGroupFixes"
              @fix-one="applyFixById"
              @focus="onValidationFocus"
            />
            <TabsContent value="command" class="mt-0 space-y-4">
              <div class="rounded-md border border-border/60 bg-muted/40 p-4 space-y-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <h3 class="text-sm font-semibold text-foreground">
                      {{ t("presetEditor.advanced.title") }}
                    </h3>
                    <p class="text-xs text-muted-foreground mt-1">
                      {{ t("presetEditor.advanced.description") }}
                    </p>
                    <p v-if="isCustomCommandPreset" class="text-xs text-amber-400 mt-2">
                      {{ t("presetEditor.advanced.customPresetHint") }}
                    </p>
                  </div>
                  <Label class="inline-flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <Checkbox v-model:checked="advancedEnabled" />
                    <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
                  </Label>
                </div>

                <div class="space-y-2">
                  <Label class="text-xs">
                    {{ t("presetEditor.advanced.templateLabel") }}
                  </Label>
                  <Textarea
                    v-model="ffmpegTemplate"
                    data-testid="preset-command-template"
                    :placeholder="t('presetEditor.advanced.templatePlaceholder')"
                    class="min-h-[160px] text-xs font-mono"
                  />
                  <div class="flex flex-col gap-2">
                    <div class="min-w-0">
                      <p :class="parseHintClass" class="text-xs">
                        {{ parseHint || (t("presetEditor.advanced.templateHint") as string) }}
                      </p>
                      <p class="mt-1 text-[10px] text-muted-foreground leading-snug">
                        {{ t("presetEditor.advanced.quickValidateScope") }}
                      </p>
                      <PresetTemplateValidationStatus
                        v-if="quickValidateResult && quickValidateResult.outcome !== 'ok'"
                        :busy="quickValidateBusy"
                        :result="quickValidateResult"
                      />
                    </div>
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        class="text-[11px] whitespace-normal h-auto leading-snug"
                        @click="handleParseTemplateFromCommand"
                      >
                        {{ t("presetEditor.advanced.parseButton") }}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        class="text-[11px]"
                        :class="quickValidateButtonToneClass"
                        :disabled="quickValidateBusy || !isCustomCommandPreset"
                        @mouseenter="quickValidateHover = true"
                        @mouseleave="quickValidateHover = false"
                        @click="handleQuickValidate"
                      >
                        {{ quickValidateButtonLabel }}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="global" class="mt-0 space-y-4">
              <PresetGlobalTab :global-config="globalConfig" />
            </TabsContent>

            <TabsContent value="input" class="mt-0 space-y-4">
              <PresetInputTab :input-timeline="inputTimeline" />
            </TabsContent>

            <TabsContent value="mapping" class="mt-0 space-y-4">
              <PresetMappingTab :mapping="mapping" />
            </TabsContent>

            <TabsContent value="video" class="mt-0 space-y-4">
              <PresetVideoTab :video="video" :is-copy-encoder="isCopyEncoder" :rate-control-label="rateControlLabel" />
            </TabsContent>

            <TabsContent value="audio" class="mt-0 space-y-4">
              <PresetAudioTab :audio="audio" :subtitles="subtitles" :is-copy-encoder="isCopyEncoder" />
            </TabsContent>

            <TabsContent value="filters" class="mt-0 space-y-4">
              <PresetFiltersTab :filters="filters" />
            </TabsContent>

            <TabsContent value="container" class="mt-0 space-y-4">
              <PresetContainerTab :container="container" />
            </TabsContent>

            <TabsContent value="hardware" class="mt-0 space-y-4">
              <PresetHardwareTab :hardware="hardware" />
            </TabsContent>
          </div>

          <UltimateParameterPanelPreviewPane
            :active-tab="activeTab"
            :current-insights="currentInsights"
            :current-preset-snapshot="currentPresetSnapshot"
            :all-presets="props.presets"
            :highlighted-command-tokens="highlightedCommandTokens"
            :parse-hint="parseHint"
            :parse-hint-class="parseHintClass"
            :copy-hint="copyHint"
            :advanced-enabled="advancedEnabled"
            :ffmpeg-template="ffmpegTemplate"
            :is-token-focused="isTokenFocused"
            :on-preview-token-click="onPreviewTokenClick"
            :on-copy-command="handleCopyCommand"
            :on-copy-template="handleCopyTemplate"
          />
        </div>
      </Tabs>

      <div class="p-4 border-t border-border bg-muted/60 flex justify-between items-center">
        <Button
          variant="ghost"
          class="px-4 py-2 text-muted-foreground hover:text-foreground font-medium"
          @click="emit('cancel')"
        >
          {{ t("common.cancel") }}
        </Button>
        <Button class="px-6 py-2 font-medium flex items-center gap-2 transition-colors" @click="handleSave">
          {{ t("presetEditor.actions.update") }}
        </Button>
      </div>
    </div>
  </div>
</template>
