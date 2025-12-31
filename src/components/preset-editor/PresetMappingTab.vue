<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, MappingConfig } from "@/types";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping: DeepWritable<MappingConfig> = props.mapping;

const { t } = useI18n();

const AUTO_VALUE = "__auto__";

const mapMetadataModeValue = computed<string>(() => {
  const v = mapping.mapMetadataFromInputFileIndex;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : AUTO_VALUE;
});
const mapChaptersModeValue = computed<string>(() => {
  const v = mapping.mapChaptersFromInputFileIndex;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : AUTO_VALUE;
});

const mapMetadataModeLabel = computed<string>(() => {
  if (mapMetadataModeValue.value === "-1") return t("presetEditor.panel.mapMetadataModeDisable");
  if (mapMetadataModeValue.value === "0") return t("presetEditor.panel.mapMetadataModeCopyFromInput0");
  if (mapMetadataModeValue.value !== AUTO_VALUE)
    return t("presetEditor.panel.mapMetadataModeCopyFromInputN", { index: mapMetadataModeValue.value });
  return t("presetEditor.panel.mapMetadataModeAuto");
});
const mapChaptersModeLabel = computed<string>(() => {
  if (mapChaptersModeValue.value === "-1") return t("presetEditor.panel.mapChaptersModeDisable");
  if (mapChaptersModeValue.value === "0") return t("presetEditor.panel.mapChaptersModeCopyFromInput0");
  if (mapChaptersModeValue.value !== AUTO_VALUE)
    return t("presetEditor.panel.mapChaptersModeCopyFromInputN", { index: mapChaptersModeValue.value });
  return t("presetEditor.panel.mapChaptersModeAuto");
});
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
      {{ t("presetEditor.panel.mappingTitle") }}
    </h3>

    <div class="">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-[10px] mb-1 block">
              {{ t("presetEditor.panel.mapMetadataLabel") }}
            </Label>
            <HelpTooltipIcon :text="t('presetEditor.panel.mapMetadataHelp')" />
          </div>
          <Select
            :model-value="mapMetadataModeValue"
            @update:model-value="
              (value) => {
                const raw = value == null ? '' : String(value);
                if (!raw || raw === AUTO_VALUE) {
                  mapping.mapMetadataFromInputFileIndex = undefined;
                  return;
                }
                const n = Number(raw);
                mapping.mapMetadataFromInputFileIndex = Number.isFinite(n) ? n : undefined;
              }
            "
          >
            <SelectTrigger class="h-9 text-xs">
              <SelectValue>{{ mapMetadataModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="AUTO_VALUE">
                {{ t("presetEditor.panel.mapMetadataModeAuto") }}
              </SelectItem>
              <SelectItem value="-1">
                {{ t("presetEditor.panel.mapMetadataModeDisable") }}
              </SelectItem>
              <SelectItem value="0">
                {{ t("presetEditor.panel.mapMetadataModeCopyFromInput0") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <div class="flex items-center gap-1">
            <Label class="text-[10px] mb-1 block">
              {{ t("presetEditor.panel.mapChaptersLabel") }}
            </Label>
            <HelpTooltipIcon :text="t('presetEditor.panel.mapChaptersHelp')" />
          </div>
          <Select
            :model-value="mapChaptersModeValue"
            @update:model-value="
              (value) => {
                const raw = value == null ? '' : String(value);
                if (!raw || raw === AUTO_VALUE) {
                  mapping.mapChaptersFromInputFileIndex = undefined;
                  return;
                }
                const n = Number(raw);
                mapping.mapChaptersFromInputFileIndex = Number.isFinite(n) ? n : undefined;
              }
            "
          >
            <SelectTrigger class="h-9 text-xs">
              <SelectValue>{{ mapChaptersModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="AUTO_VALUE">
                {{ t("presetEditor.panel.mapChaptersModeAuto") }}
              </SelectItem>
              <SelectItem value="-1">
                {{ t("presetEditor.panel.mapChaptersModeDisable") }}
              </SelectItem>
              <SelectItem value="0">
                {{ t("presetEditor.panel.mapChaptersModeCopyFromInput0") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.mapLabel") }}
        </Label>
        <HelpTooltipIcon :text="t('presetEditor.panel.mapHelp')" />
      </div>
      <Textarea
        :model-value="(mapping.maps ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.mapPlaceholder')"
        class="min-h-[60px] text-[10px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.maps = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <div class="">
      <div class="flex items-center gap-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.dispositionLabel") }}
        </Label>
        <HelpTooltipIcon :text="t('presetEditor.panel.dispositionHelp')" />
      </div>
      <Textarea
        :model-value="(mapping.dispositions ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.dispositionPlaceholder')"
        class="min-h-[50px] text-[10px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.dispositions = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <div class="">
      <div class="flex items-center gap-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.metadataLabel") }}
        </Label>
        <HelpTooltipIcon :text="t('presetEditor.panel.metadataHelp')" />
      </div>
      <Textarea
        :model-value="(mapping.metadata ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.metadataPlaceholder')"
        class="min-h-[50px] text-[10px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.metadata = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.mappingHelp") }}
    </p>
  </div>
</template>
