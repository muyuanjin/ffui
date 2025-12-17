<script setup lang="ts">
import { computed } from "vue";
import type { GlobalConfig, LogLevel } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  globalConfig: GlobalConfig;
}>();

// We intentionally treat the config object as mutable state, just like in the
// original monolithic component, to avoid introducing extra glue logic.
const globalConfig = props.globalConfig as any;

const { t } = useI18n();

// 计算当前覆盖策略的显示文字，用于 title 提示
const overwriteBehaviorTitle = computed(() => {
  const value = globalConfig.overwriteBehavior ?? "ask";
  const map: Record<string, string> = {
    ask: t("presetEditor.panel.overwriteAsk"),
    overwrite: t("presetEditor.panel.overwriteYes"),
    noOverwrite: t("presetEditor.panel.overwriteNo"),
  };
  return map[value] ?? "";
});
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
      {{ t("presetEditor.panel.globalTitle") }}
    </h3>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.overwriteBehaviorLabel") }}
        </Label>
        <Select
          :model-value="globalConfig.overwriteBehavior ?? 'ask'"
          @update:model-value="(value) => { globalConfig.overwriteBehavior = value as any; }"
        >
          <SelectTrigger class="h-9 text-xs" :title="overwriteBehaviorTitle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">
              {{ t("presetEditor.panel.overwriteAsk") }}
            </SelectItem>
            <SelectItem value="overwrite">
              {{ t("presetEditor.panel.overwriteYes") }}
            </SelectItem>
            <SelectItem value="noOverwrite">
              {{ t("presetEditor.panel.overwriteNo") }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.logLevelLabel") }}
        </Label>
        <Select
          :model-value="globalConfig.logLevel ?? ''"
          @update:model-value="
            (value) => {
              const raw = value == null ? '' : String(value);
              if (!raw) {
                globalConfig.logLevel = undefined;
              } else {
                globalConfig.logLevel = raw as LogLevel;
              }
            }
          "
        >
          <SelectTrigger class="h-9 text-xs">
            <SelectValue :placeholder="t('presetEditor.panel.logLevelPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quiet">quiet</SelectItem>
            <SelectItem value="panic">panic</SelectItem>
            <SelectItem value="fatal">fatal</SelectItem>
            <SelectItem value="error">error</SelectItem>
            <SelectItem value="warning">warning</SelectItem>
            <SelectItem value="info">info</SelectItem>
            <SelectItem value="verbose">verbose</SelectItem>
            <SelectItem value="debug">debug</SelectItem>
            <SelectItem value="trace">trace</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div class="flex gap-3">
      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          v-model:checked="globalConfig.hideBanner"
          class="h-3 w-3 border-border bg-background"
        />
        <span>
          {{ t("presetEditor.panel.hideBannerLabel") }}
        </span>
      </label>
      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          v-model:checked="globalConfig.enableReport"
          class="h-3 w-3 border-border bg-background"
        />
        <span>
          {{ t("presetEditor.panel.enableReportLabel") }}
        </span>
      </label>
    </div>
  </div>
</template>
