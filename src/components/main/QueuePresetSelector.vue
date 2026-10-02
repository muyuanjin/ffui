<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Video, Music, Image as ImageIcon } from "lucide-vue-next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
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
const open = ref(false);
const fallbackLabel = computed(() =>
  props.unifiedPresetId
    ? (props.presets.find((preset) => preset.id === props.unifiedPresetId)?.name ??
      t("app.queuePresetSelection.missing", { id: props.unifiedPresetId }))
    : t("app.queueDefaultPresetPlaceholder"),
);
const presetLabel = (id?: string) =>
  id
    ? (props.presets.find((preset) => preset.id === id)?.name ?? t("app.queuePresetSelection.missing", { id }))
    : t("app.queuePresetSelection.followUnified", { name: fallbackLabel.value });
const selectedFor = (kind: "video" | "audio" | "image") =>
  props.selection.mode === "byMedia" ? props.selection[kind] : undefined;
const badges = computed(() =>
  props.selection.mode === "byMedia"
    ? OUTPUT_MEDIA_KINDS.map((kind) => ({
        kind,
        label: selectedFor(kind) ? presetLabel(selectedFor(kind)) : fallbackLabel.value,
        title: `${t(`formatSelect.groups.${kind}`)}: ${presetLabel(selectedFor(kind))}`,
      }))
    : [
        {
          kind: "all",
          label: presetLabel(props.unifiedPresetId ?? undefined),
          title: presetLabel(props.unifiedPresetId ?? undefined),
        },
      ],
);
const updateKind = (kind: "video" | "audio" | "image", value: unknown) => {
  if (props.selection.mode !== "byMedia") return;
  emit("update:selection", { ...props.selection, [kind]: value === "__unified__" ? undefined : String(value) });
};
</script>

<template>
  <Popover v-model:open="open">
    <div data-testid="queue-preset-summary" class="inline-flex min-w-0 max-w-full items-center">
      <span
        v-for="(badge, index) in badges"
        :key="badge.kind"
        data-testid="queue-preset-summary-badge"
        :data-media-kind="badge.kind"
        :title="badge.title"
        :aria-label="badge.title"
        class="inline-flex h-7 min-w-0 items-center gap-1 border border-border/60 border-r-0 bg-muted/60 px-2 text-[10px] text-muted-foreground"
        :class="[index === 0 ? 'rounded-l-full' : '', badge.kind === 'all' ? 'max-w-40' : 'max-w-24']"
      >
        <component
          :is="badge.kind === 'video' ? Video : badge.kind === 'audio' ? Music : ImageIcon"
          v-if="badge.kind !== 'all'"
          class="h-3 w-3 shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">{{ badge.label }}</span>
      </span>
      <PopoverTrigger as-child>
        <Button
          data-testid="ffui-queue-default-preset-trigger"
          variant="outline"
          size="sm"
          class="h-7 shrink-0 rounded-full rounded-l-none bg-card/80 px-3 py-0 text-xs"
          :title="t('app.queueDefaultPresetLabel')"
        >
          {{ t("app.queuePresetSettings") }}
        </Button>
      </PopoverTrigger>
    </div>
    <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)] space-y-3" data-testid="queue-preset-settings">
      <div class="text-sm font-medium">{{ t("app.queueDefaultPresetLabel") }}</div>
      <Select
        :model-value="selection.mode"
        @update:model-value="
          (value) => emit('update:selection', value === 'byMedia' ? { mode: 'byMedia' } : { mode: 'unified' })
        "
      >
        <SelectTrigger
          data-testid="queue-preset-selection-mode"
          class="h-8 text-xs"
          :aria-label="t('app.queueDefaultPresetLabel')"
        >
          <SelectValue>{{ t(`app.queuePresetSelection.${selection.mode}`) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unified">{{ t("app.queuePresetSelection.unified") }}</SelectItem>
          <SelectItem value="byMedia">{{ t("app.queuePresetSelection.byMedia") }}</SelectItem>
        </SelectContent>
      </Select>
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">{{ t("app.queuePresetSelection.unified") }}</div>
        <Select
          :model-value="unifiedPresetId"
          @update:model-value="(value) => emit('update:unifiedPresetId', String(value))"
        >
          <SelectTrigger
            data-testid="queue-unified-preset-trigger"
            class="h-8 text-xs"
            :title="presetLabel(unifiedPresetId ?? undefined)"
            :aria-label="t('app.queuePresetSelection.unified')"
          >
            <SelectValue>{{ presetLabel(unifiedPresetId ?? undefined) }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <template v-if="selection.mode === 'byMedia'">
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
              class="h-8 min-w-0 flex-1 text-xs"
              :title="presetLabel(selectedFor(kind))"
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
    </PopoverContent>
  </Popover>
</template>
