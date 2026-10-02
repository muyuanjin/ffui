<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Video, Music, Image as ImageIcon } from "lucide-vue-next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FFmpegPreset, QueuePresetSelection } from "@/types";
import { OUTPUT_MEDIA_KINDS } from "@/lib/outputContainerPolicy";

const props = defineProps<{
  presets: FFmpegPreset[];
  unifiedPresetId: string | null;
  selection: QueuePresetSelection;
}>();
const emit = defineEmits<{
  (event: "update:unifiedPresetId", value: string): void;
  (event: "update:selection", value: QueuePresetSelection): void;
}>();
const { t } = useI18n();
const fallbackLabel = computed(
  () =>
    props.presets.find((preset) => preset.id === props.unifiedPresetId)?.name ?? t("app.queueDefaultPresetPlaceholder"),
);
const presetLabel = (id?: string) =>
  id
    ? (props.presets.find((preset) => preset.id === id)?.name ?? t("app.queuePresetSelection.missing", { id }))
    : t("app.queuePresetSelection.followUnified", { name: fallbackLabel.value });
const selectedFor = (kind: "video" | "audio" | "image") =>
  props.selection.mode === "byMedia" ? props.selection[kind] : undefined;
const updateKind = (kind: "video" | "audio" | "image", value: unknown) => {
  if (props.selection.mode !== "byMedia") return;
  emit("update:selection", { ...props.selection, [kind]: value === "__unified__" ? undefined : String(value) });
};
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-2">
    <span class="text-xs text-muted-foreground whitespace-nowrap">{{ t("app.queueDefaultPresetLabel") }}</span>
    <Select
      :model-value="selection.mode"
      @update:model-value="
        (value) => emit('update:selection', value === 'byMedia' ? { mode: 'byMedia' } : { mode: 'unified' })
      "
    >
      <SelectTrigger data-testid="queue-preset-selection-mode" class="h-7 text-xs w-auto min-w-24 rounded-full">
        <SelectValue>{{ t(`app.queuePresetSelection.${selection.mode}`) }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unified">{{ t("app.queuePresetSelection.unified") }}</SelectItem>
        <SelectItem value="byMedia">{{ t("app.queuePresetSelection.byMedia") }}</SelectItem>
      </SelectContent>
    </Select>
    <Select
      v-if="selection.mode === 'unified'"
      :model-value="unifiedPresetId"
      @update:model-value="(value) => emit('update:unifiedPresetId', String(value))"
    >
      <SelectTrigger
        data-testid="ffui-queue-default-preset-trigger"
        class="h-7 px-3 py-0 text-xs rounded-full min-w-[160px] font-semibold bg-primary/90 text-primary-foreground shadow hover:bg-[#f9a825]/90 focus-visible:ring-1 focus-visible:ring-ring !border-transparent data-[state=open]:bg-primary/90"
      >
        <SelectValue>{{ presetLabel(unifiedPresetId ?? undefined) }}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</SelectItem>
      </SelectContent>
    </Select>
    <template v-else>
      <div v-for="kind in OUTPUT_MEDIA_KINDS" :key="kind" class="flex items-center gap-1">
        <component
          :is="kind === 'video' ? Video : kind === 'audio' ? Music : ImageIcon"
          class="h-3 w-3"
          :aria-label="t(`formatSelect.groups.${kind}`)"
        />
        <Select
          :model-value="selectedFor(kind) ?? '__unified__'"
          @update:model-value="(value) => updateKind(kind, value)"
        >
          <SelectTrigger
            :data-testid="`queue-preset-${kind}-trigger`"
            :aria-label="t('app.queuePresetSelection.inputLabel', { kind: t(`formatSelect.groups.${kind}`) })"
            class="h-7 text-xs rounded-full w-40"
          >
            <SelectValue>{{ presetLabel(selectedFor(kind)) }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unified__">{{
              t("app.queuePresetSelection.followUnified", { name: fallbackLabel })
            }}</SelectItem>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <span class="sr-only">{{ t("app.queuePresetSelection.hint") }}</span>
    </template>
  </div>
</template>
