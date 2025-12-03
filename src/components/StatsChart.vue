<script setup lang="ts">
import { computed } from "vue";
import type { FFmpegPreset } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  presets: FFmpegPreset[];
}>();

const { t } = useI18n();

const data = computed(() =>
  props.presets
    .map((p) => {
      const input = p.stats.totalInputSizeMB || 1;
      const output = p.stats.totalOutputSizeMB || 1;
      const ratio = ((1 - output / input) * 100).toFixed(1);
      const speed =
        p.stats.totalTimeSeconds > 0
          ? (p.stats.totalInputSizeMB / p.stats.totalTimeSeconds).toFixed(1)
          : "0";

      return {
        name: p.name,
        ratio: Number(ratio),
        usage: p.stats.usageCount,
        speed: Number(speed),
      };
    })
    .filter((d) => d.usage > 0),
);
</script>

<template>
  <div
    v-if="data.length === 0"
    class="flex items-center justify-center h-64 border-2 border-dashed border-border rounded-lg text-muted-foreground"
  >
    {{ t("stats.empty") }}
  </div>
  <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <Card>
      <CardHeader>
        <CardTitle class="text-base md:text-lg">
          {{ t("stats.compressionTitle") }}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div
            v-for="entry in data"
            :key="entry.name"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span class="w-24 truncate">{{ entry.name }}</span>
            <div class="flex-1 h-3 bg-muted rounded overflow-hidden">
              <div
                class="h-full rounded"
                :class="entry.ratio > 50 ? 'bg-emerald-500' : 'bg-blue-500'"
                :style="{ width: `${Math.min(entry.ratio, 100)}%` }"
              />
            </div>
            <span class="w-10 text-right text-foreground">
              {{ entry.ratio.toFixed(1) }}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle class="text-base md:text-lg">
          {{ t("stats.speedTitle") }}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="space-y-2">
          <div
            v-for="entry in data"
            :key="entry.name"
            class="flex items-end gap-2 text-xs text-muted-foreground"
          >
            <span class="w-24 truncate">{{ entry.name }}</span>
            <div class="flex-1 h-20 flex items-end gap-1">
              <div
                class="w-4 bg-amber-400 rounded-t"
                :style="{ height: `${Math.min(entry.speed * 10, 100)}%` }"
              />
            </div>
            <span class="w-10 text-right text-foreground">
              {{ entry.speed.toFixed(1) }}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
