<script setup lang="ts">
import type { DeepWritable, MappingConfig } from "@/types";
import { useI18n } from "vue-i18n";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import type { InputFileIndexMappingFieldDef } from "@/lib/presetEditorContract/parameterSchema";
import MapRulesEditor from "@/components/preset-editor/MapRulesEditor.vue";
import MetadataKeyValueEditor from "@/components/preset-editor/MetadataKeyValueEditor.vue";
import DispositionEditor from "@/components/preset-editor/DispositionEditor.vue";

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping: DeepWritable<MappingConfig> = props.mapping;

const { t } = useI18n();

const mappingFields: InputFileIndexMappingFieldDef<DeepWritable<MappingConfig>>[] = [
  {
    id: "preset-map-metadata",
    kind: "inputFileIndexMapping",
    width: "half",
    labelKey: "presetEditor.panel.mapMetadataLabel",
    helpKey: "presetEditor.panel.mapMetadataHelp",
    commandField: "mapMetadata",
    autoLabelKey: "presetEditor.panel.mapMetadataModeAuto",
    disableLabelKey: "presetEditor.panel.mapMetadataModeDisable",
    copyFromInput0LabelKey: "presetEditor.panel.mapMetadataModeCopyFromInput0",
    copyFromInputNLabelKey: "presetEditor.panel.mapMetadataModeCopyFromInputN",
    getIndex: (model) => model.mapMetadataFromInputFileIndex,
    setIndex: (model, value) => {
      model.mapMetadataFromInputFileIndex = value;
    },
    defaultCustomIndex: 1,
    includeZero: true,
    testId: "preset-mapping-map-metadata-trigger",
  },
  {
    id: "preset-map-chapters",
    kind: "inputFileIndexMapping",
    width: "half",
    labelKey: "presetEditor.panel.mapChaptersLabel",
    helpKey: "presetEditor.panel.mapChaptersHelp",
    commandField: "mapChapters",
    autoLabelKey: "presetEditor.panel.mapChaptersModeAuto",
    disableLabelKey: "presetEditor.panel.mapChaptersModeDisable",
    copyFromInput0LabelKey: "presetEditor.panel.mapChaptersModeCopyFromInput0",
    copyFromInputNLabelKey: "presetEditor.panel.mapChaptersModeCopyFromInputN",
    getIndex: (model) => model.mapChaptersFromInputFileIndex,
    setIndex: (model, value) => {
      model.mapChaptersFromInputFileIndex = value;
    },
    defaultCustomIndex: 1,
    includeZero: true,
    testId: "preset-mapping-map-chapters-trigger",
  },
];
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
      {{ t("presetEditor.panel.mappingTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <PresetSchemaField
        v-for="field in mappingFields"
        :key="field.id"
        :field="field"
        :model="mapping"
        command-group="mapping"
      />
    </div>

    <MapRulesEditor :mapping="mapping" />
    <DispositionEditor :mapping="mapping" />
    <MetadataKeyValueEditor :mapping="mapping" />

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.mappingHelp") }}
    </p>
  </div>
</template>
