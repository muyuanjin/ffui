<script setup lang="ts">
import { ref } from "vue";
import type { FFmpegPreset, SmartScanConfig } from "../types";
import { DEFAULT_SMART_SCAN_CONFIG } from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  presets: FFmpegPreset[];
}>();

const emit = defineEmits<{
  (e: "start-scan", value: SmartScanConfig): void;
  (e: "cancel"): void;
}>();

const config = ref<SmartScanConfig>({
  ...DEFAULT_SMART_SCAN_CONFIG,
  videoPresetId: props.presets[0]?.id ?? "",
});

const { t } = useI18n();
</script>

<template>
  <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
    <div
      class="bg-background w-full max-w-lg rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]"
    >
      <div
        class="p-6 border-b border-border flex justify-between items-center bg-muted/60 rounded-t-xl"
      >
        <div>
          <h2 class="text-xl font-bold text-white flex items-center gap-2">
            <span class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg">▶</span>
            {{ t("smartScan.title") }}
          </h2>
          <p class="text-muted-foreground text-sm mt-1">
            {{ t("smartScan.subtitle") }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground hover:text-foreground"
          @click="emit('cancel')"
        >
          ✕
        </Button>
      </div>

      <div class="p-6 overflow-y-auto space-y-6">
        <div class="bg-primary/10 border border-primary/40 p-4 rounded-lg text-sm text-foreground space-y-2">
          <div class="flex items-start gap-2">
            <span class="text-primary mt-0.5 shrink-0">!</span>
            <p>
              {{ t("smartScan.notice") }}
            </p>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-bold uppercase mb-3 flex items-center gap-2 text-foreground">
            <span class="text-emerald-400">▣</span>
            {{ t("smartScan.videoStrategy") }}
          </h3>
          <div class="space-y-3 pl-2 border-l-2 border-border/60">
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">
                {{ t("smartScan.targetPreset") }}
              </Label>
              <Select
                :model-value="config.videoPresetId"
                @update:model-value="(value) => (config.videoPresetId = value as string)"
              >
                <SelectTrigger class="h-8 text-xs">
                  <SelectValue :placeholder="t('smartScan.targetPresetPlaceholder') as string" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="p in presets"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">
                {{ t("smartScan.minVideoSize") }}
              </Label>
              <Input
                type="number"
                :model-value="config.minVideoSizeMB"
                class="h-8 text-xs"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string | number);
                    if (!Number.isNaN(parsed)) config.minVideoSizeMB = parsed;
                  }
                "
              />
            </div>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-bold uppercase mb-3 flex items-center gap-2 text-foreground">
            <span class="text-purple-400">▣</span>
            {{ t("smartScan.imageStrategy") }}
          </h3>
          <div class="space-y-3 pl-2 border-l-2 border-border/60">
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">
                {{ t("smartScan.targetFormat") }}
              </Label>
              <div class="flex gap-2">
                <Button
                  :variant="config.imageTargetFormat === 'avif' ? 'default' : 'outline'"
                  class="flex-1 justify-center h-8 text-xs"
                  @click="config.imageTargetFormat = 'avif'"
                >
                  AVIF
                </Button>
                <Button
                  :variant="config.imageTargetFormat === 'webp' ? 'default' : 'outline'"
                  class="flex-1 justify-center h-8 text-xs"
                  @click="config.imageTargetFormat = 'webp'"
                >
                  WebP
                </Button>
              </div>
            </div>
            <div class="space-y-1">
              <Label class="text-xs text-muted-foreground">
                {{ t("smartScan.minImageSize") }}
              </Label>
              <Input
                type="number"
                :model-value="config.minImageSizeKB"
                class="h-8 text-xs"
                @update:model-value="
                  (value) => {
                    const parsed = Number(value as string | number);
                    if (!Number.isNaN(parsed)) config.minImageSizeKB = parsed;
                  }
                "
              />
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-border">
          <Label class="block text-xs text-muted-foreground mb-1">
            {{ t("smartScan.minSavingRatioLabel") }}
          </Label>
          <div class="flex items-center gap-4">
            <Slider
              :min="0.5"
              :max="0.99"
              :step="0.01"
              :model-value="[config.minSavingRatio]"
              class="flex-1"
              @update:model-value="
                (value) => {
                  const parsed = (value as number[])[0];
                  if (typeof parsed === 'number') config.minSavingRatio = parsed;
                }
              "
            />
            <span class="text-emerald-400 font-mono font-bold w-12 text-right">
              {{ (config.minSavingRatio * 100).toFixed(0) }}%
            </span>
          </div>
          <p class="text-[10px] text-muted-foreground mt-1">
            {{
              t("smartScan.minSavingRatioHelp", {
                ratio: (config.minSavingRatio * 100).toFixed(0),
              })
            }}
          </p>
        </div>
      </div>

      <div class="p-6 border-t border-border bg-muted/60 rounded-b-xl flex justify-end">
        <Button
          class="px-6 py-3 font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
          @click="emit('start-scan', config)"
        >
          ▶ {{ t("smartScan.scanButton") }}
        </Button>
      </div>
    </div>
  </div>
</template>
