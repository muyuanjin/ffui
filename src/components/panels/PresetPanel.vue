<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { highlightFfmpegCommand, getPresetCommandPreview } from "@/lib/ffmpegCommand";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";

defineProps<{
  /** List of presets */
  presets: FFmpegPreset[];
}>();

const emit = defineEmits<{
  edit: [preset: FFmpegPreset];
  delete: [preset: FFmpegPreset];
}>();

const { t } = useI18n();

const getPresetAvgRatio = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const output = preset.stats.totalOutputSizeMB;
  if (!input || !output || input <= 0 || output <= 0) return null;
  const ratio = (1 - output / input) * 100;
  return Math.max(Math.min(ratio, 100), -100);
};

const getPresetAvgSpeed = (preset: FFmpegPreset): number | null => {
  const input = preset.stats.totalInputSizeMB;
  const time = preset.stats.totalTimeSeconds;
  if (!input || !time || time <= 0) return null;
  return input / time;
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  if (typeof navigator === "undefined" || typeof document === "undefined") return;

  try {
    if ("clipboard" in navigator && (navigator as any).clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch (error) {
    console.error("navigator.clipboard.writeText failed", error);
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (error) {
    console.error("Fallback copy to clipboard failed", error);
  }
};
</script>

<template>
  <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto">
    <Card
      v-for="preset in presets"
      :key="preset.id"
      class="relative group overflow-hidden bg-card border border-border shadow-sm"
    >
      <CardHeader class="pb-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <CardTitle class="text-base md:text-lg">
              {{ preset.name }}
            </CardTitle>
            <CardDescription class="mt-1 h-10 line-clamp-2">
              {{ preset.description }}
            </CardDescription>
          </div>
          <div class="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              class="h-7 px-3 text-[11px] rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              @click="emit('edit', preset)"
            >
              <span>{{ t("presetEditor.actions.edit") }}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-3 text-[11px] rounded-full border border-destructive/50 bg-card/70 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              @click="emit('delete', preset)"
            >
              <span>{{ t("app.actions.deletePreset") }}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="pt-0 pb-4">
        <div class="grid grid-cols-2 gap-4 text-xs md:text-sm mb-4">
          <div class="rounded-md border border-border/60 bg-muted/40 p-2">
            <span class="block text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wide">
              {{ t("presets.videoLabel") }}
            </span>
            <span class="text-primary font-mono text-xs">
              {{ preset.video.encoder }}<br />
              {{ preset.video.rateControl.toUpperCase() }}: {{ preset.video.qualityValue }}
            </span>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/40 p-2">
            <span class="block text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wide">
              {{ t("presets.audioLabel") }}
            </span>
            <span class="text-muted-foreground font-mono text-xs">
              <span v-if="preset.audio.codec === 'copy'">
                {{ t("presets.audioCopy") }}
              </span>
              <span v-else>
                {{ t("presets.audioAac", { kbps: preset.audio.bitrate ?? 0 }) }}
              </span>
            </span>
          </div>
        </div>
        <div class="mt-2 space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] text-muted-foreground uppercase tracking-wide">
              {{ t("presets.commandPreviewLabel", "命令预览") }}
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              @click="copyToClipboard(getPresetCommandPreview(preset))"
            >
              {{ t("presetEditor.advanced.copyButton", "复制命令") }}
            </Button>
          </div>
          <pre
            class="rounded-md bg-background/90 border border-border/60 px-2 py-1 text-[10px] md:text-[11px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
            v-html="highlightFfmpegCommand(getPresetCommandPreview(preset))"
          />
        </div>
        <div class="flex justify-between items-center text-[11px] text-muted-foreground">
          <div>
            {{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}
          </div>
          <div class="flex flex-wrap gap-3 justify-end text-right">
            <span>
              {{
                t("presets.totalIn", {
                  gb: (preset.stats.totalInputSizeMB / 1024).toFixed(1),
                })
              }}
            </span>
            <span v-if="getPresetAvgRatio(preset) !== null">
              {{
                t("presets.avgRatio", {
                  percent: getPresetAvgRatio(preset)?.toFixed(1) ?? "0.0",
                })
              }}
            </span>
            <span v-if="getPresetAvgSpeed(preset) !== null">
              {{
                t("presets.avgSpeed", {
                  mbps: getPresetAvgSpeed(preset)?.toFixed(1) ?? "0.0",
                })
              }}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  </section>
</template>
