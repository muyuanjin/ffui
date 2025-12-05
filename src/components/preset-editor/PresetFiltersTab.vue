<script setup lang="ts">
import type { FilterConfig } from "@/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  filters: FilterConfig;
}>();

const filters = props.filters as any;

const { t } = useI18n();
</script>

<template>
  <div class="bg-muted/40 p-4 rounded-md border border-border/60">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.filters.title") }}
    </h3>
    <div class="space-y-4">
      <div>
        <Label class="block text-sm mb-1">
          {{ t("presetEditor.filters.scaleLabel") }}
        </Label>
        <Input
          :placeholder="t('presetEditor.filters.scalePlaceholder')"
          :model-value="filters.scale ?? ''"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              filters.scale = v || undefined;
            }
          "
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ t("presetEditor.filters.scaleHelp") }}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label class="block text-xs mb-1">
            {{ t("presetEditor.filters.cropLabel", '裁剪 (crop)') }}
          </Label>
          <Input
            :model-value="filters.crop ?? ''"
            :placeholder="t('presetEditor.filters.cropPlaceholder', '例如 in_w:in_h-80')"
            class="text-xs font-mono"
            @update:model-value="
              (value) => {
                const v = String(value ?? '');
                filters.crop = v || undefined;
              }
            "
          />
        </div>
        <div>
          <Label class="block text-xs mb-1">
            {{ t("presetEditor.filters.fpsLabel", '输出帧率 (fps)') }}
          </Label>
          <Input
            :model-value="filters.fps != null ? String(filters.fps) : ''"
            :placeholder="t('presetEditor.filters.fpsPlaceholder', '保持源帧率')"
            class="text-xs"
            @update:model-value="
              (value) => {
                const v = String(value ?? '').trim();
                const parsed = v ? Number(v) : NaN;
                filters.fps = Number.isNaN(parsed) ? undefined : parsed;
              }
            "
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label class="block text-xs">
          {{ t("presetEditor.filters.vfChainLabel", '附加视频滤镜链 (-vf)') }}
        </Label>
        <Textarea
          :model-value="filters.vfChain ?? ''"
          :placeholder="
            t(
              'presetEditor.filters.vfChainPlaceholder',
              '例如 eq=contrast=1.1:brightness=0.05',
            )
          "
          class="min-h-[60px] text-[11px] font-mono"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              filters.vfChain = v || undefined;
            }
          "
        />
      </div>

      <div class="space-y-2">
        <Label class="block text-xs">
          {{ t("presetEditor.filters.afChainLabel", '附加音频滤镜链 (-af)') }}
        </Label>
        <Textarea
          :model-value="filters.afChain ?? ''"
          :placeholder="
            t('presetEditor.filters.afChainPlaceholder', '例如 acompressor=threshold=-18dB')
          "
          class="min-h-[48px] text-[11px] font-mono"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              filters.afChain = v || undefined;
            }
          "
        />
      </div>

      <div class="space-y-2">
        <Label class="block text-xs">
          {{ t("presetEditor.filters.filterComplexLabel", '复杂滤镜图 (-filter_complex)') }}
        </Label>
        <Textarea
          :model-value="filters.filterComplex ?? ''"
          :placeholder="
            t(
              'presetEditor.filters.filterComplexPlaceholder',
              '例如 [0:v]scale=1280:-2[scaled];[scaled][1:v]overlay=10:10',
            )
          "
          class="min-h-[72px] text-[11px] font-mono"
          @update:model-value="
            (value) => {
              const v = String(value ?? '');
              filters.filterComplex = v || undefined;
            }
          "
        />
      </div>
    </div>
  </div>
</template>

