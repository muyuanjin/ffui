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

const queueViewModeLabelKey = computed(() => {
  switch (props.queueViewModeModel) {
    case "icon-small":
      return "queue.viewModes.iconSmall";
    case "icon-medium":
      return "queue.viewModes.iconMedium";
    case "icon-large":
      return "queue.viewModes.iconLarge";
    default:
      return `queue.viewModes.${props.queueViewModeModel}`;
  }
});

const outputDialogOpen = ref(false);
const effectiveOutputPolicy = computed<OutputPolicy>(() => props.queueOutputPolicy ?? DEFAULT_OUTPUT_POLICY);
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
        data-testid="ffui-queue-output-settings"
        type="button"
        variant="outputSettings"
        size="sm"
        class="h-7 px-3 py-0 text-xs rounded-full font-semibold text-white"
        :title="t('app.outputSettings') as string"
        @click="outputDialogOpen = true"
      >
        {{ t("app.outputSettings") }}
      </Button>

      <div v-if="presets.length > 0" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground whitespace-nowrap">
          {{ t("app.queueDefaultPresetLabel") }}
        </span>
        <Select :model-value="manualJobPresetId" @update:model-value="(v) => emit('update:manualJobPresetId', v as string)">
          <SelectTrigger
            data-testid="ffui-queue-default-preset-trigger"
            class="h-7 px-3 py-0 text-xs rounded-full min-w-[160px] font-semibold bg-primary/90 text-primary-foreground shadow hover:bg-[#f9a825]/90 focus-visible:ring-1 focus-visible:ring-ring !border-transparent data-[state=open]:bg-primary/90"
          >
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
        <SelectTrigger
          data-testid="ffui-queue-view-mode-trigger"
          class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[104px]"
        >
          <SelectValue>{{ t(queueViewModeLabelKey) }}</SelectValue>
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
        :preview-preset-id="manualJobPresetId"
        @update:model-value="(v) => emit('update:queueOutputPolicy', v)"
      />
    </DialogContent>
  </Dialog>
</template>
