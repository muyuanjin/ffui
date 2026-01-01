<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const props = defineProps<{
  groupSummary: any;
  isCustomCommandPreset: boolean;
}>();

const { t } = useI18n();

const errorBadgeClass = "h-5 px-1.5 py-0 text-[10px] tabular-nums";
const warningBadgeClass = "h-5 px-1.5 py-0 text-[10px] tabular-nums bg-amber-500/15 text-amber-200";
</script>

<template>
  <div class="w-52 border-r border-border/60 bg-muted/40 p-4">
    <TabsList class="flex flex-col items-stretch gap-1 bg-transparent p-0">
      <TabsTrigger value="command" class="justify-start w-full text-xs">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.commandTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.command.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.command.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.command.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.command.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="global" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.globalTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.global.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.global.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.global.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.global.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="input" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.inputTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.input.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.input.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.input.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.input.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="mapping" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.mappingTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.mapping.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.mapping.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.mapping.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.mapping.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="video" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.videoTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.video.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.video.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.video.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.video.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="audio" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.audioTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.audio.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.audio.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.audio.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.audio.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="filters" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.filtersTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.filters.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.filters.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.filters.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.filters.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="container" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.containerTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.container.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.container.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.container.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.container.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>

      <TabsTrigger value="hardware" class="justify-start w-full text-xs" :disabled="props.isCustomCommandPreset">
        <span class="flex items-center justify-between gap-2 w-full">
          <span>{{ t("presetEditor.panel.hardwareTab") }}</span>
          <span class="flex items-center gap-1">
            <Badge v-if="props.groupSummary.hardware.errors > 0" variant="destructive" :class="errorBadgeClass">
              {{ props.groupSummary.hardware.errors }}
            </Badge>
            <Badge v-if="props.groupSummary.hardware.warnings > 0" variant="secondary" :class="warningBadgeClass">
              {{ props.groupSummary.hardware.warnings }}
            </Badge>
          </span>
        </span>
      </TabsTrigger>
    </TabsList>
  </div>
</template>
