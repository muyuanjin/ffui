<script setup lang="ts">
import type { GlobalConfig, LogLevel } from "@/types";
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
</script>

<template>
  <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
    <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.globalTitle") }}
    </h3>

    <div class="space-y-2">
      <Label class="text-xs">
        {{ t("presetEditor.panel.overwriteBehaviorLabel") }}
      </Label>
      <Select
        :model-value="globalConfig.overwriteBehavior ?? 'ask'"
        @update:model-value="(value) => { globalConfig.overwriteBehavior = value as any; }"
      >
        <SelectTrigger class="h-8 text-xs">
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
      <p class="text-[11px] text-muted-foreground">
        {{ t("presetEditor.panel.overwriteHelp") }}
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="space-y-2">
        <Label class="text-xs">
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
          <SelectTrigger class="h-8 text-xs">
            <SelectValue
              :placeholder="t('presetEditor.panel.logLevelPlaceholder')"
            />
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
        <p class="text-[11px] text-muted-foreground">
          {{ t("presetEditor.panel.logLevelHelp") }}
        </p>
      </div>

      <div class="flex flex-col gap-2 pt-5">
        <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            v-model="globalConfig.hideBanner"
            type="checkbox"
            class="h-3 w-3 rounded border-border bg-background"
          />
          <span>
            {{ t("presetEditor.panel.hideBannerLabel") }}
          </span>
        </label>
        <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            v-model="globalConfig.enableReport"
            type="checkbox"
            class="h-3 w-3 rounded border-border bg-background"
          />
          <span>
            {{ t("presetEditor.panel.enableReportLabel") }}
          </span>
        </label>
      </div>
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.globalHelp") }}
    </p>
  </div>
</template>
