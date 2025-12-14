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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

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

const manualPreset = computed<FFmpegPreset | null>(() => {
  const list = props.presets ?? [];
  if (list.length === 0) return null;
  const id = props.manualJobPresetId;
  if (!id) return list[0] ?? null;
  return list.find((p) => p.id === id) ?? list[0] ?? null;
});

const normalizeContainerFormatForDisplay = (value: string): string => {
  const trimmed = value.trim().replace(/^\./, "").toLowerCase();
  if (!trimmed) return "";
  // ffmpeg muxer name -> common extension label
  if (trimmed === "matroska") return "mkv";
  return trimmed;
};

const inferTemplateOutputMuxer = (template: string): string | null => {
  const tokens = template.split(/\s+/).filter(Boolean);
  const outputIndex = tokens.findIndex((t) => t === "OUTPUT");
  if (outputIndex <= 0) return null;

  let lastInputIndex: number | null = null;
  for (let i = 0; i + 1 < outputIndex; i += 1) {
    if (tokens[i] === "-i") {
      lastInputIndex = i + 1;
      i += 1;
    }
  }

  const start = lastInputIndex != null ? lastInputIndex + 1 : 0;
  let fmt: string | null = null;
  for (let j = start; j + 1 < outputIndex; j += 1) {
    if (tokens[j] === "-f") {
      fmt = tokens[j + 1] ?? null;
      j += 1;
    }
  }

  const normalized = fmt ? normalizeContainerFormatForDisplay(fmt) : "";
  return normalized || null;
};

const presetDefaultContainerFormat = computed<string | null>(() => {
  const preset = manualPreset.value;
  if (!preset) return null;

  if (preset.advancedEnabled && preset.ffmpegTemplate?.trim()) {
    const fromTemplate = inferTemplateOutputMuxer(preset.ffmpegTemplate);
    if (fromTemplate) return fromTemplate;
  }

  const fromStructured = preset.container?.format ? normalizeContainerFormatForDisplay(preset.container.format) : "";
  return fromStructured || null;
});

const outputContainerBadge = computed<string>(() => {
  const policy = effectiveOutputPolicy.value;
  if (policy.container.mode === "force") {
    return normalizeContainerFormatForDisplay(policy.container.format || "mkv") || "mkv";
  }
  if (policy.container.mode === "keepInput") {
    return "input";
  }
  return presetDefaultContainerFormat.value ?? "auto";
});

const outputPolicyPreviewLines = computed(() => {
  const policy = effectiveOutputPolicy.value;
  const containerLabel =
    policy.container.mode === "force"
      ? `${normalizeContainerFormatForDisplay(policy.container.format || "mkv") || "mkv"} · ${t("outputPolicy.container.force")}`
      : policy.container.mode === "keepInput"
        ? t("outputPolicy.container.keepInput")
        : presetDefaultContainerFormat.value
          ? `${presetDefaultContainerFormat.value} · ${t("outputPolicy.container.default")}`
          : t("outputPolicy.container.default");

  const dirLabel =
    policy.directory.mode === "fixed"
      ? `${t("outputPolicy.dir.fixed")}: ${(policy.directory.directory ?? "").trim() || "—"}`
      : t("outputPolicy.dir.sameAsInput");

  const prefix = (policy.filename.prefix ?? "").trim();
  const suffix = (policy.filename.suffix ?? "").trim();
  const flags: string[] = [];
  if (policy.filename.appendTimestamp) flags.push("timestamp");
  if (policy.filename.appendEncoderQuality) flags.push("encoder+quality");
  if (typeof policy.filename.randomSuffixLen === "number" && policy.filename.randomSuffixLen > 0) {
    flags.push(`random(${policy.filename.randomSuffixLen})`);
  }
  const extras = flags.length > 0 ? flags.join(", ") : "—";

  const preserve = (() => {
    const value = policy.preserveFileTimes;
    if (value === true) return "created, modified, accessed";
    if (!value || typeof value !== "object") return "—";
    const detailed = value as { created?: boolean; modified?: boolean; accessed?: boolean };
    const parts = [
      detailed.created ? "created" : null,
      detailed.modified ? "modified" : null,
      detailed.accessed ? "accessed" : null,
    ].filter((v): v is string => !!v);
    return parts.join(", ") || "—";
  })();

  return {
    containerLabel,
    dirLabel,
    filenameLabel: `prefix=${prefix || "—"} · suffix=${suffix || "—"}`,
    filenameExtras: extras,
    preserve,
  };
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
      <HoverCard :open-delay="150" :close-delay="100">
        <HoverCardTrigger as-child>
          <div class="inline-flex items-center group">
            <span
              data-testid="ffui-queue-output-container-badge"
              class="h-7 px-2 inline-flex items-center rounded-full rounded-r-none border border-border/40 border-r-0 bg-[#90a4ae]/60 text-[10px] font-mono font-semibold uppercase tracking-wide text-white/85 select-none group-hover:bg-[#90a4ae]/70"
              :title="outputContainerBadge"
            >
              {{ outputContainerBadge }}
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
        <HoverCardContent align="end" side="bottom" :side-offset="8" class="w-[380px] p-3">
          <div data-testid="ffui-queue-output-settings-hover-preview" class="space-y-2">
            <div class="flex items-center justify-between">
              <div class="text-[11px] font-semibold text-foreground">
                {{ t("outputPolicy.previewLabel") }}
              </div>
              <div class="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                {{ outputContainerBadge }}
              </div>
            </div>
            <div class="grid grid-cols-[120px,1fr] gap-x-3 gap-y-1 text-[11px]">
              <div class="text-muted-foreground">{{ t("outputPolicy.containerLabel") }}</div>
              <div class="font-mono text-foreground">
                {{ outputPolicyPreviewLines.containerLabel }}
              </div>

              <div class="text-muted-foreground">{{ t("outputPolicy.dirLabel") }}</div>
              <div class="text-foreground truncate">
                {{ outputPolicyPreviewLines.dirLabel }}
              </div>

              <div class="text-muted-foreground">{{ t("outputPolicy.nameLabel") }}</div>
              <div class="font-mono text-foreground">
                {{ outputPolicyPreviewLines.filenameLabel }}
              </div>

              <div class="text-muted-foreground">{{ t("outputPolicy.appendOrderLabel") }}</div>
              <div class="text-foreground">
                {{ outputPolicyPreviewLines.filenameExtras }}
              </div>

              <div class="text-muted-foreground">{{ t("outputPolicy.preserveTimes") }}</div>
              <div class="text-foreground">
                {{ outputPolicyPreviewLines.preserve }}
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>

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
