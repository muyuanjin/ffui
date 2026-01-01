<script setup lang="ts">
import type { ContainerConfig, DeepWritable } from "@/types";
import { Label } from "@/components/ui/label";
import { useI18n } from "vue-i18n";
import FormatSelect from "@/components/formats/FormatSelect.vue";
import { FORMAT_CATALOG } from "@/lib/formatCatalog";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";
import MovflagsEditor from "@/components/preset-editor/MovflagsEditor.vue";

const props = defineProps<{
  container: ContainerConfig;
}>();

const container: DeepWritable<ContainerConfig> = props.container;

const { t } = useI18n();

const AUTO_FORMAT_VALUE = "__auto__";
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.containerTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1" data-command-group="container" data-command-field="format">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.formatLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.formatHelp')" />
        </div>
        <FormatSelect
          :model-value="container.format ?? AUTO_FORMAT_VALUE"
          :entries="FORMAT_CATALOG"
          :auto-value="AUTO_FORMAT_VALUE"
          :auto-label="t('presetEditor.panel.formatAutoOption')"
          :placeholder="t('presetEditor.panel.formatPlaceholder')"
          trigger-class="h-9 text-xs w-full"
          content-class="w-full"
          @update:model-value="
            (value) => {
              const v = String(value ?? AUTO_FORMAT_VALUE);
              container.format = v === AUTO_FORMAT_VALUE ? undefined : v;
            }
          "
        />
      </div>

      <div data-command-group="container" data-command-field="movflags">
        <MovflagsEditor :container="container" />
      </div>
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.containerHelp") }}
    </p>
  </div>
</template>
