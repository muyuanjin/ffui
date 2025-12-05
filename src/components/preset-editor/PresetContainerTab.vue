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
  <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.containerTitle", "容器与分片") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="space-y-1">
        <Label class="text-xs">
          {{ t("presetEditor.panel.formatLabel", "输出格式 (-f)") }}
        </Label>
        <Select
          :model-value="container.format ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              container.format = v || undefined;
            }
          "
        >
          <SelectTrigger class="h-8 text-xs">
            <SelectValue
              :placeholder="t('presetEditor.panel.formatPlaceholder', '根据输出扩展名自动推断')"
            />
          </SelectTrigger>
          <SelectContent>
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
        <Label class="text-xs">
          {{ t("presetEditor.panel.movflagsLabel", "movflags（使用 + 组合）") }}
        </Label>
        <Input
          :model-value="(container.movflags ?? []).join('+')"
          :placeholder="t('presetEditor.panel.movflagsPlaceholder', '例如 faststart+frag_keyframe')"
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
      {{
        t(
          "presetEditor.panel.containerHelp",
          "常见场景可以仅依赖输出扩展名推断容器；需要启用 faststart/HLS/DASH 等高级特性时再在此处补充选项。",
        )
      }}
    </p>
  </div>
</template>

