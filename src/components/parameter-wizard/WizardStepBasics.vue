<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AudioConfig, VideoConfig } from "@/types";

const props = defineProps<{
  name: string;
  description: string;
  t: (key: string, params?: any) => string | unknown;
}>();

const emit = defineEmits<{
  (e: "update:name", value: string): void;
  (e: "update:description", value: string): void;
  (
    e: "select-recipe",
    payload: {
      name: string;
      description: string;
      video: Partial<VideoConfig>;
      audio?: Partial<AudioConfig>;
      nextStep?: number;
      advancedEnabled?: boolean;
      ffmpegTemplate?: string;
    },
  ): void;
}>();

const applyRecipe = (payload: {
  nameKey: string;
  description: string;
  video: Partial<VideoConfig>;
  audio?: Partial<AudioConfig>;
  nextStep?: number;
  advancedEnabled?: boolean;
  ffmpegTemplate?: string;
}) => {
  emit("select-recipe", {
    name: props.t(payload.nameKey) as string,
    description: payload.description,
    video: payload.video,
    audio: payload.audio,
    nextStep: payload.nextStep ?? 2,
    advancedEnabled: payload.advancedEnabled,
    ffmpegTemplate: payload.ffmpegTemplate,
  });
};
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <Label for="preset-name">
        {{ t("presetEditor.name") }}
      </Label>
      <Input
        id="preset-name"
        :model-value="name"
        :placeholder="t('presetEditor.namePlaceholder')"
        @update:model-value="(value) => emit('update:name', value as string)"
      />
    </div>
    <div class="space-y-1">
      <Label for="preset-description">
        {{ t("presetEditor.description") }}
      </Label>
      <Textarea
        id="preset-description"
        :model-value="description"
        :placeholder="t('presetEditor.descriptionPlaceholder')"
        class="min-h-[96px]"
        @update:model-value="(value) => emit('update:description', value as string)"
      />
    </div>
    <div class="bg-primary/10 border border-primary/40 p-4 rounded-md">
      <h4 class="text-primary font-semibold flex items-center gap-2 mb-2">
        <span class="text-sm">ℹ</span>
        {{ t("presetEditor.recipes.title") }}
      </h4>
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.hqArchive',
              description: 'x264 Slow CRF 18. Visually lossless.',
              video: {
                encoder: 'libx264',
                rateControl: 'crf',
                qualityValue: 18,
                preset: 'slow',
                tune: 'film',
                profile: undefined,
              },
            })
          "
        >
          {{ t("presetEditor.recipes.hqArchive") }}
        </Button>
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.fastTranscode',
              description: 'NVENC H.265. Fast conversion for devices.',
              video: {
                encoder: 'hevc_nvenc',
                rateControl: 'cq',
                qualityValue: 28,
                preset: 'p5',
                tune: undefined,
                profile: undefined,
              },
            })
          "
        >
          {{ t("presetEditor.recipes.fastTranscode") }}
        </Button>
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.hevcVisuallyLossless',
              description: 'HEVC NVENC constqp main10, tuned for visually lossless archival with 10‑bit output.',
              video: {
                encoder: 'hevc_nvenc',
              },
              advancedEnabled: true,
              ffmpegTemplate:
                '-hide_banner -i INPUT -map 0 -c:v hevc_nvenc -preset:v p7 -profile:v main10 -rc:v constqp -rc-lookahead 1 -spatial-aq 0 -temporal-aq 1 -weighted_pred 0 -init_qpI 20 -init_qpP 20 -init_qpB 24 -qp_cb_offset 10 -qp_cr_offset 11 -b_ref_mode 1 -dpb_size 4 -multipass 1 -g 60 -bf 3 -pix_fmt yuv420p10le -color_range tv -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a copy -movflags +faststart OUTPUT',
              nextStep: 5,
            })
          "
        >
          {{ t("presetEditor.recipes.hevcVisuallyLossless") }}
        </Button>
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.modernAv1',
              description: 'High efficiency AV1 encoding.',
              video: {
                encoder: 'libsvtav1',
                rateControl: 'crf',
                qualityValue: 34,
                preset: '6',
                tune: undefined,
                profile: undefined,
              },
            })
          "
        >
          {{ t("presetEditor.recipes.modernAv1") }}
        </Button>
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.av1VisuallyLossless',
              description:
                'AV1 NVENC constqp QP 18, 10‑bit, tuned for visually lossless archival with excellent size/quality ratio.',
              video: {
                encoder: 'libsvtav1',
              },
              advancedEnabled: true,
              ffmpegTemplate:
                '-i INPUT -map 0 -c:v av1_nvenc -preset p7 -tune hq -rc constqp -qp 18 -pix_fmt p010le -b_ref_mode each -bf 3 -rc-lookahead 32 -spatial-aq 1 -temporal-aq 1 -c:a copy OUTPUT',
              nextStep: 5,
            })
          "
        >
          {{ t("presetEditor.recipes.av1VisuallyLossless") }}
        </Button>
        <Button
          variant="outline"
          class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
          @click="
            applyRecipe({
              nameKey: 'presetEditor.recipes.streamCopy',
              description: 'No re-encode, remux only.',
              video: {
                encoder: 'copy',
                rateControl: 'cbr',
                qualityValue: 0,
                preset: 'copy',
                tune: undefined,
                profile: undefined,
              },
              audio: { codec: 'copy' },
            })
          "
        >
          {{ t("presetEditor.recipes.streamCopy") }}
        </Button>
      </div>
    </div>
  </div>
</template>
