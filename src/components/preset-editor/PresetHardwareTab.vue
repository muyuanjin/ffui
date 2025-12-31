<script setup lang="ts">
import type { DeepWritable, HardwareConfig } from "@/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  hardware: HardwareConfig;
}>();

const hardware: DeepWritable<HardwareConfig> = props.hardware;

const { t } = useI18n();
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.hardwareTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.hwaccelLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.hwaccelHelp')" />
        </div>
        <Select
          :model-value="hardware.hwaccel ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              hardware.hwaccel = v || undefined;
            }
          "
        >
          <SelectTrigger class="h-9 text-xs">
            <SelectValue :placeholder="t('presetEditor.panel.hwaccelPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cuda">cuda</SelectItem>
            <SelectItem value="qsv">qsv</SelectItem>
            <SelectItem value="vaapi">vaapi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.hwaccelDeviceLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.hwaccelDeviceHelp')" />
        </div>
        <Input
          :model-value="hardware.hwaccelDevice ?? ''"
          :placeholder="t('presetEditor.panel.hwaccelDevicePlaceholder')"
          class="h-9 text-xs"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              hardware.hwaccelDevice = v || undefined;
            }
          "
        />
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.hwaccelOutputFormatLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.hwaccelOutputFormatHelp')" />
        </div>
        <Input
          :model-value="hardware.hwaccelOutputFormat ?? ''"
          :placeholder="t('presetEditor.panel.hwaccelOutputFormatPlaceholder')"
          class="h-9 text-xs"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              hardware.hwaccelOutputFormat = v || undefined;
            }
          "
        />
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] mb-1 block">
            {{ t("presetEditor.panel.bitstreamFiltersLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.bitstreamFiltersHelp')" />
        </div>
        <Textarea
          :model-value="(hardware.bitstreamFilters ?? []).join('\n')"
          :placeholder="t('presetEditor.panel.bitstreamFiltersPlaceholder')"
          class="min-h-[72px] text-[11px] font-mono"
          @update:model-value="
            (value) => {
              const text = String(value ?? '');
              const filters = text
                .split('\n')
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
              hardware.bitstreamFilters = filters.length > 0 ? filters : undefined;
            }
          "
        />
      </div>
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.hardwareHelp") }}
    </p>
  </div>
</template>
