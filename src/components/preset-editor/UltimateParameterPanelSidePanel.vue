<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { FFmpegPreset } from "@/types";
import type { PresetInsights } from "@/lib/presetInsights";
import PresetRadarChart from "@/components/preset-editor/PresetRadarChart.vue";

type FocusedTarget = { group: string; field?: string } | null;

const props = defineProps<{
  activeTab: string;
  focusedTarget: FocusedTarget;
  highlightedCommandTokens: any[];
  parseHint: string;
  parseHintClass: string;
  advancedEnabled: boolean;
  ffmpegTemplate: string;
  commandPreview: string;
  currentInsights: PresetInsights;
  currentPresetSnapshot: FFmpegPreset;
  allPresets?: FFmpegPreset[];
}>();

const emit = defineEmits<{
  (e: "update:activeTab", value: string): void;
  (e: "update:focusedTarget", value: FocusedTarget): void;
}>();

const { t } = useI18n();

const isTokenFocused = (token: any) => {
  const target = props.focusedTarget;
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
  if (group) emit("update:activeTab", group);
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

const onPreviewTokenClick = async (token: any) => {
  const group = String(token?.group ?? "").trim();
  if (!group) return;
  const field = String(token?.field ?? "").trim() || undefined;
  emit("update:focusedTarget", { group, field });
  await focusEditorField(group, field);
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
  await copyToClipboard(props.commandPreview);
};
const handleCopyTemplate = async () => {
  const tpl = props.ffmpegTemplate.trim();
  if (!tpl) return;
  await copyToClipboard(tpl);
};

const showCustomHint = computed(() => props.advancedEnabled && props.ffmpegTemplate.trim().length > 0);
</script>

<template>
  <div class="w-80 border-l border-border/60 bg-muted/40 p-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
    <div class="space-y-2 flex-shrink-0">
      <PresetRadarChart
        :metrics="currentInsights.radar"
        :has-stats="currentInsights.hasStats"
        :preset="currentPresetSnapshot"
        :all-presets="allPresets"
      />
      <div class="text-[11px] text-muted-foreground space-y-1">
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.scenarioLabel") }}: </span>
          <span class="ml-1">
            {{ t(`presetEditor.panel.scenario.${currentInsights.scenario}`) }}
          </span>
        </div>
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.encoderFamilyLabel") }}: </span>
          <span class="ml-1">
            {{ t(`presetEditor.panel.encoderFamily.${currentInsights.encoderFamily}`) }}
          </span>
        </div>
        <div>
          <span class="font-medium text-foreground"> {{ t("presetEditor.panel.beginnerFriendlyLabel") }}: </span>
          <span class="ml-1">
            {{
              currentInsights.isBeginnerFriendly
                ? t("presetEditor.panel.beginnerFriendlyYes")
                : t("presetEditor.panel.beginnerFriendlyNo")
            }}
          </span>
        </div>
        <p v-if="currentInsights.mayIncreaseSize" class="text-[11px] text-amber-400">
          {{ t("presetEditor.panel.mayIncreaseSizeWarning") }}
        </p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 border-b border-border/60 pb-2 mt-2 flex-shrink-0">
      <h3 class="text-xs font-semibold text-foreground">
        {{ t("presetEditor.advanced.previewTitle") }}
      </h3>
      <div class="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" class="h-7 px-2 text-[11px]" @click="handleCopyCommand">
          {{ t("presetEditor.advanced.copyCommandButton") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="ffmpegTemplate.trim().length === 0"
          @click="handleCopyTemplate"
        >
          {{ t("presetEditor.advanced.copyTemplateButton") }}
        </Button>
      </div>
    </div>
    <p v-if="copyHint" class="text-[10px] text-muted-foreground flex-shrink-0">
      {{ copyHint }}
    </p>
    <pre
      class="flex-1 min-h-[80px] rounded-md bg-background/90 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
      :data-active-group="activeTab"
    ><span
      v-for="(token, idx) in highlightedCommandTokens"
      :key="idx"
      :class="[
        token.className,
        token.group ? 'cursor-pointer hover:bg-muted/20 rounded-sm' : '',
        isTokenFocused(token) ? 'bg-primary/15 text-foreground rounded-sm' : '',
      ]"
      :title="token.title"
      :data-group="token.group"
      :data-field="token.field"
      @click="onPreviewTokenClick(token)"
      v-text="token.text"
    ></span></pre>
    <p :class="[parseHintClass, 'flex-shrink-0']">
      {{ parseHint || (t("presetEditor.advanced.templateHint") as string) }}
    </p>
    <p v-if="showCustomHint" class="text-[11px] text-amber-400 flex-shrink-0">
      {{ t("presetEditor.advanced.customPresetHint") }}
    </p>
    <div class="space-y-1 mt-2 flex-shrink-0">
      <Label class="text-[11px]">
        {{ t("presetEditor.advanced.templateLabel") }}
      </Label>
      <Textarea
        :model-value="ffmpegTemplate"
        readonly
        :placeholder="t('presetEditor.advanced.templatePlaceholder')"
        class="min-h-[60px] text-[11px] font-mono"
      />
    </div>
  </div>
</template>
