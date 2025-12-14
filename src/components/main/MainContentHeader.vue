<script setup lang="ts">
import { computed, ref } from "vue";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { FFmpegPreset, OutputPolicy, PresetSortMode } from "@/types";
import { sortPresets } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

const props = defineProps<{
  activeTab: string;
  currentTitle: string | unknown;
  currentSubtitle: string | unknown;
  jobsLength: number;
  completedCount: number;
  manualJobPresetId: string | null;
  presets: FFmpegPreset[];
  queueViewModeModel: string;
  presetSortMode?: PresetSortMode;
  queueOutputPolicy?: OutputPolicy;
}>();

const emit = defineEmits<{
  (e: "update:manualJobPresetId", value: string | null): void;
  (e: "update:queueViewModeModel", value: string): void;
  (e: "openPresetWizard"): void;
  (e: "update:queueOutputPolicy", value: OutputPolicy): void;
}>();

const { t } = useI18n();

// 根据排序模式排序预设列表
const sortedPresets = computed(() => sortPresets(props.presets, props.presetSortMode ?? "manual"));

const outputDialogOpen = ref(false);
const effectiveOutputPolicy = computed<OutputPolicy>(() => props.queueOutputPolicy ?? DEFAULT_OUTPUT_POLICY);

const outputPolicySummary = computed(() => {
  const p = effectiveOutputPolicy.value;
  const container =
    p.container.mode === "force"
      ? p.container.format
      : p.container.mode === "keepInput"
        ? t("outputPolicy.container.keepInput")
        : t("outputPolicy.container.default");
  const dir =
    p.directory.mode === "fixed"
      ? t("outputPolicy.dir.fixed")
      : t("outputPolicy.dir.sameAsInput");
  const tags: string[] = [];
  if (p.filename.appendTimestamp) tags.push(t("outputPolicy.name.timestamp"));
  if (p.filename.appendEncoderQuality) tags.push(t("outputPolicy.name.encoderTag"));
  if (p.filename.randomSuffixLen !== undefined) tags.push(`${t("outputPolicy.name.random")}×${p.filename.randomSuffixLen}`);
  if (p.preserveFileTimes) tags.push(t("outputPolicy.preserveTimes"));
  return [container, dir, ...tags].join(" · ");
});
</script>

<template>
  <header class="shrink-0 px-4 py-2 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between gap-2">
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-3 min-h-8">
        <h2 class="text-xl font-semibold tracking-tight text-foreground">
          {{ currentTitle }}
        </h2>
        <span
          v-if="activeTab === 'queue' && jobsLength > 0"
          class="bg-muted text-xs text-muted-foreground px-2 py-1 rounded-full"
        >
          {{ completedCount }} / {{ jobsLength }}
        </span>
      </div>
      <p class="text-xs text-muted-foreground min-h-[1.25rem]">
        {{ currentSubtitle }}
      </p>
    </div>

    <div v-if="activeTab === 'queue'" class="flex items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        class="h-7 px-3 py-0 text-xs rounded-full"
        :title="t('outputPolicy.containerLabel') as string"
        @click="outputDialogOpen = true"
      >
        {{ t("app.outputSettings") }}
        <span class="ml-2 text-[10px] text-muted-foreground font-mono hidden md:inline">
          {{ outputPolicySummary }}
        </span>
      </Button>

      <div v-if="presets.length > 0" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground whitespace-nowrap">
          {{ t("app.queueDefaultPresetLabel") }}
        </span>
        <Select :model-value="manualJobPresetId" @update:model-value="(v) => emit('update:manualJobPresetId', v as string)">
          <SelectTrigger class="h-7 px-3 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[160px]">
            <SelectValue :placeholder="t('app.queueDefaultPresetPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in sortedPresets" :key="preset.id" :value="preset.id">
              {{ preset.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Select :model-value="queueViewModeModel" @update:model-value="(v) => emit('update:queueViewModeModel', v as string)">
        <SelectTrigger class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[104px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="detail">{{ t("queue.viewModes.detail") }}</SelectItem>
          <SelectItem value="compact">{{ t("queue.viewModes.compact") }}</SelectItem>
          <SelectItem value="icon-small">{{ t("queue.viewModes.iconSmall") }}</SelectItem>
          <SelectItem value="icon-medium">{{ t("queue.viewModes.iconMedium") }}</SelectItem>
          <SelectItem value="icon-large">{{ t("queue.viewModes.iconLarge") }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-else-if="activeTab === 'presets'" class="flex items-center gap-3">
      <Button variant="default" size="sm" class="h-8 px-4 rounded-full" @click="emit('openPresetWizard')">
        {{ t("app.newPreset") }}
      </Button>
    </div>
  </header>

  <Dialog :open="outputDialogOpen" @update:open="(v) => (outputDialogOpen = !!v)">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ t("app.outputSettings") }}</DialogTitle>
      </DialogHeader>
      <OutputPolicyEditor
        :model-value="effectiveOutputPolicy"
        @update:model-value="(v) => emit('update:queueOutputPolicy', v)"
      />
    </DialogContent>
  </Dialog>
</template>
