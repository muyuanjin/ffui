<script setup lang="ts">
import type { DeepWritable, FilterConfig } from "@/types";
import { useI18n } from "vue-i18n";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import type {
  NumberFieldDef,
  PresetFieldDef,
  StringFieldDef,
  TextFieldDef,
} from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  filters: FilterConfig;
}>();

const filters: DeepWritable<FilterConfig> = props.filters;

const { t } = useI18n();

const scaleField: StringFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-scale",
  kind: "string",
  width: "full",
  labelKey: "presetEditor.filters.scaleLabel",
  helpKey: "presetEditor.filters.scaleHelp",
  descriptionKey: "presetEditor.filters.scaleHelp",
  placeholderKey: "presetEditor.filters.scalePlaceholder",
  getValue: (model) => model.scale,
  setValue: (model, value) => {
    model.scale = value;
  },
};

const cropField: StringFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-crop",
  kind: "string",
  width: "half",
  labelKey: "presetEditor.filters.cropLabel",
  helpKey: "presetEditor.filters.cropHelp",
  placeholderKey: "presetEditor.filters.cropPlaceholder",
  mono: true,
  getValue: (model) => model.crop,
  setValue: (model, value) => {
    model.crop = value;
  },
};

const fpsField: NumberFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-fps",
  kind: "number",
  width: "half",
  labelKey: "presetEditor.filters.fpsLabel",
  helpKey: "presetEditor.filters.fpsHelp",
  placeholderKey: "presetEditor.filters.fpsPlaceholder",
  unit: "fps",
  min: 0,
  step: 0.1,
  getValue: (model) => model.fps,
  setValue: (model, value) => {
    model.fps = value;
  },
};

const vfChainField: TextFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-vfchain",
  kind: "text",
  width: "full",
  labelKey: "presetEditor.filters.vfChainLabel",
  helpKey: "presetEditor.filters.vfChainHelp",
  placeholderKey: "presetEditor.filters.vfChainPlaceholder",
  commandField: "vf",
  mono: true,
  minRows: 4,
  trim: false,
  getValue: (model) => model.vfChain,
  setValue: (model, value) => {
    model.vfChain = value;
  },
};

const afChainField: TextFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-afchain",
  kind: "text",
  width: "full",
  labelKey: "presetEditor.filters.afChainLabel",
  helpKey: "presetEditor.filters.afChainHelp",
  placeholderKey: "presetEditor.filters.afChainPlaceholder",
  commandField: "af",
  mono: true,
  minRows: 3,
  trim: false,
  getValue: (model) => model.afChain,
  setValue: (model, value) => {
    model.afChain = value;
  },
};

const filterComplexField: TextFieldDef<DeepWritable<FilterConfig>> = {
  id: "preset-filter-complex",
  kind: "text",
  width: "full",
  labelKey: "presetEditor.filters.filterComplexLabel",
  helpKey: "presetEditor.filters.filterComplexHelp",
  placeholderKey: "presetEditor.filters.filterComplexPlaceholder",
  commandField: "filterComplex",
  mono: true,
  minRows: 5,
  trim: false,
  getValue: (model) => model.filterComplex,
  setValue: (model, value) => {
    model.filterComplex = value;
  },
};

const filterFields: PresetFieldDef<DeepWritable<FilterConfig>>[] = [
  scaleField,
  cropField,
  fpsField,
  vfChainField,
  afChainField,
  filterComplexField,
];
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.filters.title") }}
    </h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <PresetSchemaField
        v-for="field in filterFields"
        :key="field.id"
        :field="field"
        :model="filters"
        command-group="filters"
      />
    </div>
  </div>
</template>
