<script setup lang="ts">
import { computed, ref } from "vue";
import type { FFmpegPreset } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "vue-i18n";
import { usePresetEditor } from "@/composables";
import { computePresetInsights } from "@/lib/presetInsights";
import PresetGlobalTab from "@/components/preset-editor/PresetGlobalTab.vue";
import PresetInputTab from "@/components/preset-editor/PresetInputTab.vue";
import PresetMappingTab from "@/components/preset-editor/PresetMappingTab.vue";
import PresetVideoTab from "@/components/preset-editor/PresetVideoTab.vue";
import PresetAudioTab from "@/components/preset-editor/PresetAudioTab.vue";
import PresetFiltersTab from "@/components/preset-editor/PresetFiltersTab.vue";
import PresetContainerTab from "@/components/preset-editor/PresetContainerTab.vue";
import PresetHardwareTab from "@/components/preset-editor/PresetHardwareTab.vue";
import PresetRadarChart from "@/components/preset-editor/PresetRadarChart.vue";

const props = defineProps<{
  /** Preset being edited in the full parameter panel. */
  initialPreset: FFmpegPreset;
}>();

const emit = defineEmits<{
  (e: "save", value: FFmpegPreset): void;
  (e: "cancel"): void;
  // Allow jumping back to the guided wizard while keeping the edited state.
  (e: "switchToWizard", value: FFmpegPreset): void;
}>();

const { t } = useI18n();

const activeTab = ref<"global" | "input" | "mapping" | "video" | "audio" | "filters" | "container" | "hardware">(
  "video",
);

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
  highlightedCommandHtml,
  parseHintClass,
  buildPresetFromState,
  handleParseTemplateFromCommand,
} = usePresetEditor({ initialPreset: props.initialPreset, t });

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
</script>

<template>
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div
      class="bg-background w-full max-w-5xl rounded-xl shadow-2xl border border-border flex flex-col h-[min(640px,90vh)]"
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
        <div class="w-52 border-r border-border/60 bg-muted/40 p-4">
          <TabsList class="flex flex-col items-stretch gap-1 bg-transparent p-0">
            <TabsTrigger value="global" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.globalTab") }}
            </TabsTrigger>
            <TabsTrigger value="input" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.inputTab") }}
            </TabsTrigger>
            <TabsTrigger value="mapping" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.mappingTab") }}
            </TabsTrigger>
            <TabsTrigger value="video" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.videoTab") }}
            </TabsTrigger>
            <TabsTrigger value="audio" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.audioTab") }}
            </TabsTrigger>
            <TabsTrigger value="filters" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.filtersTab") }}
            </TabsTrigger>
            <TabsTrigger value="container" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.containerTab") }}
            </TabsTrigger>
            <TabsTrigger value="hardware" class="justify-start w-full text-xs">
              {{ t("presetEditor.panel.hardwareTab") }}
            </TabsTrigger>
          </TabsList>
        </div>

        <div class="flex-1 flex min-h-0">
          <div class="flex-1 p-6 overflow-y-auto space-y-4">
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

          <div class="w-80 border-l border-border/60 bg-muted/40 p-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
            <!-- 效果雷达图 + 简要说明 -->
            <div class="space-y-2 flex-shrink-0">
              <PresetRadarChart :metrics="currentInsights.radar" :has-stats="currentInsights.hasStats" />
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
                  <span class="font-medium text-foreground">
                    {{ t("presetEditor.panel.beginnerFriendlyLabel") }}:
                  </span>
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

            <h3 class="text-xs font-semibold text-foreground border-b border-border/60 pb-2 mt-2 flex-shrink-0">
              {{ t("presetEditor.advanced.previewTitle") }}
            </h3>
            <pre
              class="flex-1 min-h-[80px] rounded-md bg-background/90 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
              :data-active-group="activeTab"
              v-html="highlightedCommandHtml"
            />
            <p :class="[parseHintClass, 'flex-shrink-0']">
              {{ parseHint || (t("presetEditor.advanced.templateHint") as string) }}
            </p>
            <div class="space-y-1 mt-2 flex-shrink-0">
              <Label class="text-[11px]">
                {{ t("presetEditor.advanced.templateLabel") }}
              </Label>
              <Textarea
                v-model="ffmpegTemplate"
                :placeholder="t('presetEditor.advanced.templatePlaceholder')"
                class="min-h-[60px] text-[11px] font-mono"
              />
              <Label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                <Checkbox v-model:checked="advancedEnabled" />
                <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
              </Label>
              <Button
                variant="ghost"
                size="sm"
                class="mt-1 h-6 px-0 justify-start text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                @click="handleParseTemplateFromCommand"
              >
                {{ t("presetEditor.advanced.parseButton") }}
              </Button>
            </div>
          </div>
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
