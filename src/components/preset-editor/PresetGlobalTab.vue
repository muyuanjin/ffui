<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, GlobalConfig, LogLevel, OverwriteBehavior } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import PresetSchemaField from "@/components/preset-editor/PresetSchemaField.vue";
import type { EnumFieldDef } from "@/lib/presetEditorContract/parameterSchema";

const props = defineProps<{
  globalConfig: GlobalConfig;
}>();

// We intentionally treat the config object as mutable state, just like in the
// original monolithic component, to avoid introducing extra glue logic.
const globalConfig: DeepWritable<GlobalConfig> = props.globalConfig;

const { t } = useI18n();

const hideBannerChecked = computed<boolean>({
  get() {
    return globalConfig.hideBanner ?? false;
  },
  set(value) {
    globalConfig.hideBanner = value;
  },
});

const enableReportChecked = computed<boolean>({
  get() {
    return globalConfig.enableReport ?? false;
  },
  set(value) {
    globalConfig.enableReport = value;
  },
});

const overwriteBehaviorField: EnumFieldDef<DeepWritable<GlobalConfig>> = {
  id: "preset-overwrite-behavior",
  kind: "enum",
  width: "half",
  labelKey: "presetEditor.panel.overwriteBehaviorLabel",
  helpKey: "presetEditor.panel.overwriteHelp",
  commandField: "overwrite",
  options: [
    { value: "ask", labelKey: "presetEditor.panel.overwriteAsk" },
    { value: "overwrite", labelKey: "presetEditor.panel.overwriteYes" },
    { value: "noOverwrite", labelKey: "presetEditor.panel.overwriteNo" },
  ],
  getValue: (model) => (model.overwriteBehavior ?? "ask") as OverwriteBehavior,
  setValue: (model, value) => {
    model.overwriteBehavior = (value ?? "ask") as OverwriteBehavior;
  },
  testId: "preset-global-overwrite-behavior-trigger",
};

const logLevelField: EnumFieldDef<DeepWritable<GlobalConfig>> = {
  id: "preset-loglevel",
  kind: "enum",
  width: "half",
  labelKey: "presetEditor.panel.logLevelLabel",
  helpKey: "presetEditor.panel.logLevelHelp",
  commandField: "loglevel",
  allowUnset: true,
  unsetLabelKey: "presetEditor.panel.logLevelPlaceholder",
  options: [
    { value: "quiet" },
    { value: "panic" },
    { value: "fatal" },
    { value: "error" },
    { value: "warning" },
    { value: "info" },
    { value: "verbose" },
    { value: "debug" },
    { value: "trace" },
  ],
  getValue: (model) => model.logLevel,
  setValue: (model, value) => {
    model.logLevel = (value || undefined) as LogLevel | undefined;
  },
};
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
      {{ t("presetEditor.panel.globalTitle") }}
    </h3>

    <div class="grid grid-cols-2 gap-3">
      <PresetSchemaField :field="overwriteBehaviorField" :model="globalConfig" command-group="global" />
      <PresetSchemaField :field="logLevelField" :model="globalConfig" command-group="global" />
    </div>

    <div class="flex gap-3">
      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          v-model:checked="hideBannerChecked"
          class="h-3 w-3 border-border bg-background"
          data-command-group="global"
          data-command-field="hideBanner"
        />
        <span>
          {{ t("presetEditor.panel.hideBannerLabel") }}
        </span>
        <HelpTooltipIcon :text="t('presetEditor.panel.hideBannerHelp')" />
      </label>
      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          v-model:checked="enableReportChecked"
          class="h-3 w-3 border-border bg-background"
          data-command-group="global"
          data-command-field="report"
        />
        <span>
          {{ t("presetEditor.panel.enableReportLabel") }}
        </span>
        <HelpTooltipIcon :text="t('presetEditor.panel.enableReportHelp')" />
      </label>
    </div>
  </div>
</template>
