<script setup lang="ts">
import type { DeepWritable, HardwareConfig } from "@/types";
import { useI18n } from "vue-i18n";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import type { EnumFieldDef, StringFieldDef, StringLinesFieldDef } from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  hardware: HardwareConfig;
}>();

const hardware: DeepWritable<HardwareConfig> = props.hardware;

const { t } = useI18n();

const hwaccelField: EnumFieldDef<DeepWritable<HardwareConfig>> = {
  id: "preset-hwaccel",
  kind: "enum",
  width: "half",
  labelKey: "presetEditor.panel.hwaccelLabel",
  helpKey: "presetEditor.panel.hwaccelHelp",
  placeholderKey: "presetEditor.panel.hwaccelPlaceholder",
  commandField: "hwaccel",
  allowUnset: true,
  options: [{ value: "cuda" }, { value: "qsv" }, { value: "vaapi" }],
  getValue: (model) => model.hwaccel,
  setValue: (model, value) => {
    model.hwaccel = value;
  },
};

const hwaccelDeviceField: StringFieldDef<DeepWritable<HardwareConfig>> = {
  id: "preset-hwaccel-device",
  kind: "string",
  width: "half",
  labelKey: "presetEditor.panel.hwaccelDeviceLabel",
  helpKey: "presetEditor.panel.hwaccelDeviceHelp",
  placeholderKey: "presetEditor.panel.hwaccelDevicePlaceholder",
  commandField: "hwaccel_device",
  getValue: (model) => model.hwaccelDevice,
  setValue: (model, value) => {
    model.hwaccelDevice = value;
  },
};

const hwaccelOutputFormatField: StringFieldDef<DeepWritable<HardwareConfig>> = {
  id: "preset-hwaccel-output-format",
  kind: "string",
  width: "half",
  labelKey: "presetEditor.panel.hwaccelOutputFormatLabel",
  helpKey: "presetEditor.panel.hwaccelOutputFormatHelp",
  placeholderKey: "presetEditor.panel.hwaccelOutputFormatPlaceholder",
  commandField: "hwaccel_output_format",
  getValue: (model) => model.hwaccelOutputFormat,
  setValue: (model, value) => {
    model.hwaccelOutputFormat = value;
  },
};

const bitstreamFiltersField: StringLinesFieldDef<DeepWritable<HardwareConfig>> = {
  id: "preset-bsf-lines",
  kind: "stringLines",
  width: "half",
  labelKey: "presetEditor.panel.bitstreamFiltersLabel",
  helpKey: "presetEditor.panel.bitstreamFiltersHelp",
  placeholderKey: "presetEditor.panel.bitstreamFiltersPlaceholder",
  commandField: "bitstreamFilters",
  mono: true,
  minRows: 4,
  getValue: (model) => model.bitstreamFilters,
  setValue: (model, value) => {
    model.bitstreamFilters = value;
  },
};
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.hardwareTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <PresetSchemaField :field="hwaccelField" :model="hardware" command-group="hardware" />
      <PresetSchemaField :field="hwaccelDeviceField" :model="hardware" command-group="hardware" />
      <PresetSchemaField :field="hwaccelOutputFormatField" :model="hardware" command-group="hardware" />
      <PresetSchemaField :field="bitstreamFiltersField" :model="hardware" command-group="hardware" />
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.hardwareHelp") }}
    </p>
  </div>
</template>
