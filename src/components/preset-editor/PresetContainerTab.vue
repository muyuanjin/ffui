<script setup lang="ts">
import type { ContainerConfig } from "@/types";
import { Input } from "@/components/ui/input";
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
  container: ContainerConfig;
}>();

const container = props.container as any;

const { t } = useI18n();
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.containerTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.formatLabel") }}
        </Label>
        <Select
          :model-value="container.format ?? '__auto__'"
          @update:model-value="
            (value) => {
              const v = String(value ?? '__auto__');
              container.format = v === '__auto__' ? undefined : v;
            }
          "
        >
          <SelectTrigger class="h-9 text-xs">
            <SelectValue
              :placeholder="t('presetEditor.panel.formatPlaceholder')"
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">
              {{ t("presetEditor.panel.formatAutoOption") }}
            </SelectItem>
            <SelectItem value="mp4">mp4</SelectItem>
            <SelectItem value="mkv">mkv</SelectItem>
            <SelectItem value="mov">mov</SelectItem>
            <SelectItem value="webm">webm</SelectItem>
            <SelectItem value="mpegts">mpegts</SelectItem>
            <SelectItem value="hls">hls</SelectItem>
            <SelectItem value="dash">dash</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.movflagsLabel") }}
        </Label>
        <Input
          :model-value="(container.movflags ?? []).join('+')"
          :placeholder="t('presetEditor.panel.movflagsPlaceholder')"
          class="h-8 text-xs font-mono"
          @update:model-value="
            (value) => {
              const text = String(value ?? '');
              const flags = text
                .split(/[+,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
              container.movflags = flags.length > 0 ? flags : undefined;
            }
          "
        />
      </div>
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.containerHelp") }}
    </p>
  </div>
</template>
