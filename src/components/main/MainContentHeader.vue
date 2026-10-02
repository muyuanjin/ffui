<script setup lang="ts">
import { computed, ref } from "vue";
import { Video, Music, Image as ImageIcon } from "lucide-vue-next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { FFmpegPreset, OutputPolicy, PresetSortDirection, PresetSortMode, QueuePresetSelection } from "@/types";
import QueuePresetSelector from "./QueuePresetSelector.vue";
import { sortPresets } from "@/lib/presetSorter";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { OUTPUT_MEDIA_KINDS } from "@/lib/outputContainerPolicy";
import { planManualPresetGroups } from "@/lib/manualPresetRouting";
import {
  inferPresetDefaultOutputContainer,
  normalizeForcedContainerExtensionForPreview,
  previewOutputPathLocal,
} from "@/lib/outputPolicyPreview";
import type { QueueViewMode } from "@/types";

const props = defineProps<{
  activeTab: string;
  currentTitle: string | unknown;
  currentSubtitle: string | unknown;
  jobsLength: number;
  completedCount: number;
  manualJobPresetId: string | null;
  queuePresetSelection?: QueuePresetSelection;
  presets: FFmpegPreset[];
  queueViewModeModel: QueueViewMode;
  presetSortMode?: PresetSortMode;
  presetSortDirection?: PresetSortDirection;
  queueOutputPolicy?: OutputPolicy;
  carouselAutoRotationSpeed?: number;
}>();

const emit = defineEmits<{
  (e: "update:manualJobPresetId", value: string | null): void;
  (e: "update:queuePresetSelection", value: QueuePresetSelection): void;
  (e: "update:queueViewModeModel", value: QueueViewMode): void;
  (e: "openPresetWizard"): void;
  (e: "update:queueOutputPolicy", value: OutputPolicy): void;
  (e: "update:carouselAutoRotationSpeed", value: number): void;
}>();

const { t } = useI18n();

// 根据排序模式排序预设列表
const sortedPresets = computed(() =>
  sortPresets(props.presets, props.presetSortMode ?? "manual", { direction: props.presetSortDirection }),
);

const queueViewModeLabelKey = computed(() => {
  switch (props.queueViewModeModel) {
    case "icon-small":
      return "queue.viewModes.iconSmall";
    case "icon-medium":
      return "queue.viewModes.iconMedium";
    case "icon-large":
      return "queue.viewModes.iconLarge";
    case "carousel-3d":
      return "queue.viewModes.carousel3d";
    default:
      return `queue.viewModes.${props.queueViewModeModel}`;
  }
});

const isCarouselMode = computed(() => props.queueViewModeModel === "carousel-3d");

const outputDialogOpen = ref(false);
const effectiveOutputPolicy = computed<OutputPolicy>(() => props.queueOutputPolicy ?? DEFAULT_OUTPUT_POLICY);

const manualPreset = computed<FFmpegPreset | null>(() => {
  const list = props.presets ?? [];
  if (list.length === 0) return null;
  const id = props.manualJobPresetId;
  if (!id) return list[0] ?? null;
  return list.find((p) => p.id === id) ?? list[0] ?? null;
});
const manualPreviewPresetId = computed(() => manualPreset.value?.id ?? null);

const presetDefaultContainerFormat = computed<string | null>(() =>
  props.queuePresetSelection?.mode === "byMedia" ? null : inferPresetDefaultOutputContainer(manualPreset.value),
);

const outputContainerBadges = computed(() => {
  const policy = effectiveOutputPolicy.value;
  if (policy.container.mode === "byMedia") {
    const container = policy.container;
    return OUTPUT_MEDIA_KINDS.map((kind) => ({
      kind,
      label: container[kind] ? normalizeForcedContainerExtensionForPreview(container[kind]) : "auto",
      title: `${t(`formatSelect.groups.${kind}`)}: ${container[kind] ?? t("outputPolicy.container.followPreset")}`,
    }));
  }
  const single = (label: string) => [{ kind: "all", label, title: label }];
  if (policy.container.mode === "force") {
    return single(normalizeForcedContainerExtensionForPreview(policy.container.format));
  }
  if (policy.container.mode === "keepInput") {
    return single("input");
  }
  return single(presetDefaultContainerFormat.value ?? "auto");
});
const outputContainerBadge = computed(() => outputContainerBadges.value.map((badge) => badge.label).join(" / "));

const hoverPreviewContainerText = computed(() => {
  const policy = effectiveOutputPolicy.value;
  if (policy.container.mode === "byMedia") {
    return outputContainerBadges.value.map((badge) => badge.title).join(" · ");
  }
  if (policy.container.mode === "force") {
    const fmt = normalizeForcedContainerExtensionForPreview(policy.container.format || "mkv") || "mkv";
    return `${t("outputPolicy.container.force")}：${fmt}`;
  }
  if (policy.container.mode === "keepInput") {
    return t("outputPolicy.container.keepInput");
  }
  if (presetDefaultContainerFormat.value) {
    return `${t("outputPolicy.container.default")}（${presetDefaultContainerFormat.value}）`;
  }
  return t("outputPolicy.container.default");
});

const hoverPreviewDirectoryText = computed(() => {
  const policy = effectiveOutputPolicy.value;
  if (policy.directory.mode === "fixed") {
    const dir = (policy.directory.directory ?? "").trim();
    return dir ? `${t("outputPolicy.dir.fixed")}：${dir}` : t("outputPolicy.dir.fixed");
  }
  return t("outputPolicy.dir.sameAsInput");
});

const hoverPreviewFilenameText = computed(() => {
  const policy = effectiveOutputPolicy.value;
  const none = t("presets.noFilters");

  const parts: string[] = [];
  const prefix = (policy.filename.prefix ?? "").trim();
  const suffix = (policy.filename.suffix ?? "").trim();
  if (prefix) parts.push(`${t("outputPolicy.name.prefix")}：${prefix}`);
  if (suffix) parts.push(`${t("outputPolicy.name.suffix")}：${suffix}`);

  const regexPattern = (policy.filename.regexReplace?.pattern ?? "").trim();
  if (regexPattern) {
    const repl = policy.filename.regexReplace?.replacement ?? "";
    parts.push(`${t("outputPolicy.regexLabel")}：${regexPattern} → ${repl}`);
  }

  return parts.length > 0 ? parts.join(" · ") : none;
});

const hoverPreviewAppendText = computed(() => {
  const policy = effectiveOutputPolicy.value;
  const none = t("presets.noFilters");

  const parts: string[] = [];
  if (policy.filename.appendTimestamp) parts.push(t("outputPolicy.name.timestamp"));
  if (policy.filename.appendEncoderQuality) parts.push(t("outputPolicy.name.encoderTag"));
  if (typeof policy.filename.randomSuffixLen === "number" && policy.filename.randomSuffixLen > 0) {
    parts.push(
      `${t("outputPolicy.name.random")}（${t("outputPolicy.name.randomHint")}：${policy.filename.randomSuffixLen}）`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : none;
});

const hoverPreviewPreserveTimesText = computed(() => {
  const value = effectiveOutputPolicy.value.preserveFileTimes;
  const none = t("presets.noFilters");

  if (value === true) {
    return [
      t("outputPolicy.preserveTimesCreated"),
      t("outputPolicy.preserveTimesModified"),
      t("outputPolicy.preserveTimesAccessed"),
    ].join(" · ");
  }
  if (!value || typeof value !== "object") return none;

  const detailed = value as { created?: boolean; modified?: boolean; accessed?: boolean };
  const parts = [
    detailed.created ? t("outputPolicy.preserveTimesCreated") : null,
    detailed.modified ? t("outputPolicy.preserveTimesModified") : null,
    detailed.accessed ? t("outputPolicy.preserveTimesAccessed") : null,
  ].filter((v): v is string => !!v);

  return parts.length > 0 ? parts.join(" · ") : none;
});

const hoverPreviewExamples = computed(() => {
  const policy = effectiveOutputPolicy.value;
  const inputs =
    policy.container.mode === "byMedia" || props.queuePresetSelection?.mode === "byMedia"
      ? ["C:/videos/input.mp4", "C:/audio/input.wav", "C:/images/input.jpg"]
      : ["C:/videos/input.mp4"];
  const base = (p: string) => p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
  return inputs.map((input) => {
    if (!props.presets.length) return { input: base(input), output: base(previewOutputPathLocal(input, policy)) };
    let groups: ReturnType<typeof planManualPresetGroups>;
    try {
      groups = planManualPresetGroups(
        [input],
        props.presets,
        props.manualJobPresetId,
        props.queuePresetSelection ?? { mode: "unified" },
      );
    } catch (error) {
      return { input: base(input), output: error instanceof Error ? error.message : String(error) };
    }
    const preset = props.presets.find((entry) => entry.id === groups[0]?.presetId);
    return { input: base(input), output: base(previewOutputPathLocal(input, policy, { preset })) };
  });
});
</script>

<template>
  <header
    class="shrink-0 px-4 py-2 border-b border-border bg-card/60 backdrop-blur flex flex-wrap items-center justify-between gap-2"
  >
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-3 min-h-8">
        <h2 class="text-xl font-semibold tracking-tight text-foreground">
          {{ currentTitle }}
        </h2>
        <span
          v-if="activeTab === 'queue' && jobsLength > 0"
          data-testid="ffui-queue-job-count"
          class="shrink-0 whitespace-nowrap bg-muted text-xs text-muted-foreground px-2 py-1 rounded-full"
        >
          {{ completedCount }} / {{ jobsLength }}
        </span>
      </div>
      <p class="text-xs text-muted-foreground min-h-[1.25rem]">
        {{ currentSubtitle }}
      </p>
    </div>

    <div v-if="activeTab === 'queue'" class="ml-auto max-w-full flex flex-wrap items-center justify-end gap-3">
      <HoverCard :open-delay="150" :close-delay="100">
        <HoverCardTrigger as-child>
          <div class="inline-flex items-center group">
            <span
              v-for="(badge, index) in outputContainerBadges"
              :key="badge.kind"
              data-testid="ffui-queue-output-container-badge"
              :data-media-kind="badge.kind"
              class="h-7 px-2 inline-flex shrink-0 items-center gap-1 whitespace-nowrap border border-border/40 border-r-0 bg-[#90a4ae]/60 text-[10px] font-mono font-semibold uppercase tracking-wide text-white/85 select-none group-hover:bg-[#90a4ae]/70"
              :class="index === 0 ? 'rounded-l-full' : ''"
              :title="badge.title"
              :aria-label="badge.title"
            >
              <template v-if="badge.kind !== 'all'">
                <component
                  :is="badge.kind === 'video' ? Video : badge.kind === 'audio' ? Music : ImageIcon"
                  class="h-3 w-3 shrink-0 text-white/65"
                  aria-hidden="true"
                />
                <span class="sr-only">{{ t(`formatSelect.groups.${badge.kind}`) }}</span>
              </template>
              {{ badge.label }}
            </span>
            <Button
              data-testid="ffui-queue-output-settings"
              type="button"
              variant="outputSettings"
              size="sm"
              class="h-7 px-3 py-0 text-xs rounded-full rounded-l-none font-semibold text-white"
              :title="t('app.outputSettings') as string"
              @click="outputDialogOpen = true"
            >
              {{ t("app.outputSettings") }}
            </Button>
          </div>
        </HoverCardTrigger>
        <HoverCardContent align="end" side="bottom" :side-offset="8" class="w-[420px] p-3">
          <div data-testid="ffui-queue-output-settings-hover-preview" class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="text-[11px] font-semibold text-foreground">{{ t("app.outputSettings") }}</div>
              <div class="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                {{ outputContainerBadge }}
              </div>
            </div>
            <div class="grid grid-cols-[108px,1fr] gap-x-3 gap-y-1 text-[11px]">
              <div class="text-muted-foreground">{{ t("outputPolicy.previewLabel") }}</div>
              <div class="text-foreground">
                <div v-for="example in hoverPreviewExamples" :key="example.input">
                  <span class="font-mono">{{ example.input }}</span>
                  <span class="text-muted-foreground mx-1">→</span>
                  <span class="font-mono">{{ example.output }}</span>
                </div>
              </div>

              <div class="text-muted-foreground">{{ t("outputPolicy.containerLabel") }}</div>
              <div class="text-foreground">{{ hoverPreviewContainerText }}</div>

              <div class="text-muted-foreground">{{ t("outputPolicy.dirLabel") }}</div>
              <div class="text-foreground truncate">{{ hoverPreviewDirectoryText }}</div>

              <div class="text-muted-foreground">{{ t("outputPolicy.nameLabel") }}</div>
              <div class="text-foreground">{{ hoverPreviewFilenameText }}</div>

              <div class="text-muted-foreground">{{ t("outputPolicy.appendOrderLabel") }}</div>
              <div class="text-foreground">{{ hoverPreviewAppendText }}</div>

              <div class="text-muted-foreground">{{ t("outputPolicy.preserveTimes") }}</div>
              <div class="text-foreground">{{ hoverPreviewPreserveTimesText }}</div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>

      <QueuePresetSelector
        v-if="presets.length > 0"
        :presets="sortedPresets"
        :unified-preset-id="manualJobPresetId"
        :selection="queuePresetSelection ?? { mode: 'unified' }"
        @update:unified-preset-id="(value) => emit('update:manualJobPresetId', value)"
        @update:selection="(value) => emit('update:queuePresetSelection', value)"
      />

      <Select
        :model-value="queueViewModeModel"
        @update:model-value="(v) => emit('update:queueViewModeModel', v as QueueViewMode)"
      >
        <SelectTrigger
          data-testid="ffui-queue-view-mode-trigger"
          class="h-7 w-auto px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[104px]"
        >
          <SelectValue>{{ t(queueViewModeLabelKey) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="detail" data-testid="ffui-queue-view-mode-detail">{{
            t("queue.viewModes.detail")
          }}</SelectItem>
          <SelectItem value="compact" data-testid="ffui-queue-view-mode-compact">{{
            t("queue.viewModes.compact")
          }}</SelectItem>
          <SelectItem value="mini" data-testid="ffui-queue-view-mode-mini">{{ t("queue.viewModes.mini") }}</SelectItem>
          <SelectItem value="icon-large" data-testid="ffui-queue-view-mode-icon-large">{{
            t("queue.viewModes.iconLarge")
          }}</SelectItem>
          <SelectItem value="icon-medium" data-testid="ffui-queue-view-mode-icon-medium">{{
            t("queue.viewModes.iconMedium")
          }}</SelectItem>
          <SelectItem value="icon-small" data-testid="ffui-queue-view-mode-icon-small">{{
            t("queue.viewModes.iconSmall")
          }}</SelectItem>
          <SelectItem value="carousel-3d" data-testid="ffui-queue-view-mode-carousel-3d">{{
            t("queue.viewModes.carousel3d")
          }}</SelectItem>
        </SelectContent>
      </Select>

      <div v-if="isCarouselMode" class="flex items-center gap-2">
        <span class="text-[10px] text-muted-foreground whitespace-nowrap">
          {{ t("queue.carouselSpeedLabel") }}
        </span>
        <input
          type="range"
          min="0"
          max="10"
          step="1"
          :value="carouselAutoRotationSpeed ?? 0"
          class="w-20 h-1 accent-primary cursor-pointer"
          :title="t('queue.carouselSpeedHint') as string"
          @input="(e) => emit('update:carouselAutoRotationSpeed', Number((e.target as HTMLInputElement).value))"
        />
        <span class="text-[10px] text-muted-foreground font-mono w-4 text-center">
          {{ carouselAutoRotationSpeed ?? 0 }}
        </span>
      </div>
    </div>

    <div v-else-if="activeTab === 'presets'" class="flex items-center gap-3">
      <Button
        variant="default"
        size="sm"
        class="h-8 px-4 rounded-full"
        data-testid="ffui-new-preset"
        @click="emit('openPresetWizard')"
      >
        {{ t("app.newPreset") }}
      </Button>
    </div>
  </header>

  <Dialog :open="outputDialogOpen" @update:open="(v) => (outputDialogOpen = !!v)">
    <DialogContent class="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ t("app.outputSettings") }}</DialogTitle>
      </DialogHeader>
      <OutputPolicyEditor
        :model-value="effectiveOutputPolicy"
        :preview-preset-id="manualPreviewPresetId"
        :preview-preset="manualPreset"
        :preview-presets="presets.length ? presets : undefined"
        :preview-preset-selection="queuePresetSelection ?? { mode: 'unified' }"
        :preview-unified-preset-id="manualJobPresetId"
        @update:model-value="(v) => emit('update:queueOutputPolicy', v)"
      />
    </DialogContent>
  </Dialog>
</template>
