<script setup lang="ts">
import { computed, ref } from "vue";
import { unrefElement, useTimeoutFn } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { Video, Music, Image as ImageIcon, Layers } from "lucide-vue-next";
import { RadioGroupRoot, RadioGroupItem } from "reka-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import QueueSettingsPill from "./QueueSettingsPill.vue";
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
const triggerButton = ref<InstanceType<typeof Button> | null>(null);
const open = ref(false);
const pinned = ref(false);
const returnFocus = ref(false);
const triggerClick = ref(false);
const activeSelect = ref<string | null>(null);
const openDelay = useTimeoutFn(
  () => {
    returnFocus.value = false;
    open.value = true;
  },
  150,
  { immediate: false },
);
const closeDelay = useTimeoutFn(
  () => {
    if (!pinned.value && !activeSelect.value) open.value = false;
  },
  250,
  { immediate: false },
);
const enter = (event: PointerEvent) => {
  if (event.pointerType === "touch") return;
  closeDelay.stop();
  if (!open.value) openDelay.start();
};
const leave = () => {
  openDelay.stop();
  closeDelay.start();
};
const pin = () => {
  if (!open.value) return;
  pinned.value = true;
  returnFocus.value = true;
};
const interactOutside = (event: Event) => {
  if (event.target instanceof Node && unrefElement(triggerButton)?.contains(event.target)) event.preventDefault();
};
const updateOpen = (value: boolean) => {
  openDelay.stop();
  closeDelay.stop();
  if (triggerClick.value) {
    triggerClick.value = false;
    open.value = !pinned.value;
    pinned.value = open.value;
    returnFocus.value = true;
    return;
  }
  open.value = value;
  pinned.value = value;
};
const updateSelectOpen = (id: string, value: boolean) => {
  if (value) {
    activeSelect.value = id;
    pinned.value = true;
    returnFocus.value = true;
  } else if (activeSelect.value === id) {
    activeSelect.value = null;
  }
};
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
    : [{ kind: "all" as const, label: fallbackLabel.value, title: fallbackLabel.value }],
);
const updateKind = (kind: "video" | "audio" | "image", value: unknown) => {
  if (props.selection.mode !== "byMedia") return;
  emit("update:selection", { ...props.selection, [kind]: value === "__unified__" ? undefined : String(value) });
};
</script>

<template>
  <Popover :open="open" @update:open="updateOpen">
    <QueueSettingsPill
      v-slot="{ triggerClass }"
      :badges="badges"
      badge-test-id="queue-preset-summary-badge"
      data-testid="queue-preset-summary"
      @pointerenter="enter"
      @pointerleave="leave"
    >
      <PopoverTrigger as-child>
        <Button
          ref="triggerButton"
          data-testid="ffui-queue-default-preset-trigger"
          variant="presetSettings"
          size="sm"
          :class="triggerClass"
          :title="t('app.queuePresetSettings')"
          @click.capture="triggerClick = true"
        >
          {{ t("app.queuePresetSettings") }}
        </Button>
      </PopoverTrigger>
    </QueueSettingsPill>
    <PopoverContent
      align="end"
      :side-offset="8"
      class="w-[380px] max-w-[calc(100vw-2rem)] max-h-[var(--reka-popover-content-available-height)] overflow-y-auto rounded-xl border-border/70 bg-popover p-4 shadow-xl"
      data-testid="queue-preset-settings"
      @pointerenter="closeDelay.stop()"
      @pointerleave="leave"
      @pointerdown="pin"
      @focusin="pin"
      @interact-outside="interactOutside"
      @open-auto-focus="
        (event) => {
          if (!pinned) event.preventDefault();
        }
      "
      @close-auto-focus="
        (event) => {
          if (!returnFocus) event.preventDefault();
        }
      "
    >
      <div class="mb-3 flex items-center gap-2.5">
        <Layers class="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
        <div>
          <div class="text-sm font-semibold" data-testid="queue-preset-settings-title">
            {{ t("app.queuePresetSettings") }}
          </div>
          <div class="mt-0.5 text-[11px] text-muted-foreground">{{ t("app.queuePresetSelection.subtitle") }}</div>
        </div>
      </div>
      <RadioGroupRoot
        :model-value="selection.mode"
        orientation="horizontal"
        class="mb-3 flex rounded-full border border-border/60 bg-background/30 p-0.5"
        data-testid="queue-preset-selection-mode"
        :aria-label="t('app.queuePresetSettings')"
        @update:model-value="
          (value) => emit('update:selection', value === 'byMedia' ? { mode: 'byMedia' } : { mode: 'unified' })
        "
      >
        <RadioGroupItem
          v-for="mode in ['unified', 'byMedia'] as const"
          :key="mode"
          :value="mode"
          :data-testid="`queue-preset-mode-${mode}`"
          class="flex min-h-7 min-w-0 flex-1 items-center justify-center rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:bg-sky-700/90 data-[state=checked]:text-white data-[state=checked]:shadow-sm"
        >
          {{ t(`app.queuePresetSelection.${mode}`) }}
        </RadioGroupItem>
      </RadioGroupRoot>
      <div class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 py-2">
        <div class="text-[11px] font-medium text-muted-foreground">{{ t("app.queuePresetSelection.unified") }}</div>
        <Select
          :model-value="unifiedPresetId"
          @update:open="(value) => updateSelectOpen('unified', value)"
          @update:model-value="(value) => emit('update:unifiedPresetId', String(value))"
        >
          <SelectTrigger
            data-testid="queue-unified-preset-trigger"
            class="h-auto min-h-8 rounded-lg border-border/60 bg-background/25 px-2 py-1.5 text-[11px] hover:border-sky-500/60 [&>div]:justify-start [&>div]:text-left [&>div>span]:whitespace-normal [&>div>span]:break-words"
            :title="fallbackLabel"
            :aria-label="t('app.queuePresetSelection.unified')"
          >
            <SelectValue>{{ fallbackLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div v-if="selection.mode === 'byMedia'" class="mt-1 divide-y divide-border/40 border-t border-border/60">
        <div
          v-for="kind in OUTPUT_MEDIA_KINDS"
          :key="kind"
          class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 py-2"
        >
          <div class="flex items-center gap-2 text-xs font-medium">
            <component
              :is="kind === 'video' ? Video : kind === 'audio' ? Music : ImageIcon"
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {{ t(`formatSelect.groups.${kind}`) }}
          </div>
          <Select
            :model-value="selectedFor(kind) ?? '__unified__'"
            @update:open="(value) => updateSelectOpen(kind, value)"
            @update:model-value="(value) => updateKind(kind, value)"
          >
            <SelectTrigger
              :data-testid="`queue-preset-${kind}-trigger`"
              :aria-label="t('app.queuePresetSelection.inputLabel', { kind: t(`formatSelect.groups.${kind}`) })"
              class="h-auto min-h-8 rounded-lg border-border/60 bg-background/25 px-2 py-1.5 text-[11px] hover:border-sky-500/60 [&>div]:justify-start [&>div]:text-left [&>div>span]:whitespace-normal [&>div>span]:break-words"
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
      </div>
      <p class="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        {{ t("app.queuePresetSelection.hint") }}
      </p>
    </PopoverContent>
  </Popover>
</template>
