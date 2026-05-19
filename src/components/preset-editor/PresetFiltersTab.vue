<script setup lang="ts">
import type { DeepWritable, FilterConfig } from "@/types";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import type { PresetFieldDef, StringFieldDef, TextFieldDef } from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  filters: FilterConfig;
}>();

const filters: DeepWritable<FilterConfig> = props.filters;

const { t } = useI18n();

const fpsQuickPicks = [
  { label: "23.976 NTSC Film · 24000/1001", value: "24000/1001" },
  { label: "24 Film · film", value: "film" },
  { label: "25 PAL · pal", value: "pal" },
  { label: "29.97 NTSC · 30000/1001", value: "30000/1001" },
  { label: "59.94 NTSC · 60000/1001", value: "60000/1001" },
] as const;

const fpsValue = computed<string>({
  get: () => filters.fps ?? "",
  set: (value) => {
    const next = String(value ?? "").trim();
    filters.fps = next.length > 0 ? next : undefined;
  },
});

const selectFpsQuickPick = (value: string) => {
  filters.fps = value;
};

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

const topFilterFields: PresetFieldDef<DeepWritable<FilterConfig>>[] = [scaleField, cropField];
const advancedFilterFields: PresetFieldDef<DeepWritable<FilterConfig>>[] = [
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
        v-for="field in topFilterFields"
        :key="field.id"
        :field="field"
        :model="filters"
        command-group="filters"
      />
      <div class="sm:col-span-1 space-y-2">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block" for="preset-filter-fps">
            {{ t("presetEditor.filters.fpsLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.filters.fpsHelp') as string" />
        </div>
        <Input
          id="preset-filter-fps"
          v-model="fpsValue"
          :placeholder="t('presetEditor.filters.fpsPlaceholder') as string"
          class="h-9 text-xs font-mono"
          data-testid="preset-filter-fps"
          data-command-group="filters"
          data-command-field="fps"
        />
        <div class="flex flex-wrap gap-1.5" data-testid="preset-filter-fps-quick-picks">
          <Button
            v-for="item in fpsQuickPicks"
            :key="item.value"
            type="button"
            :variant="filters.fps === item.value ? 'secondary' : 'outline'"
            size="xs"
            class="h-7 max-w-full px-2 text-[10px] font-mono"
            :data-testid="`preset-filter-fps-quick-${item.value}`"
            @click="selectFpsQuickPick(item.value)"
          >
            <span class="truncate">{{ item.label }}</span>
          </Button>
        </div>
      </div>
      <PresetSchemaField
        v-for="field in advancedFilterFields"
        :key="field.id"
        :field="field"
        :model="filters"
        command-group="filters"
      />
    </div>
  </div>
</template>
