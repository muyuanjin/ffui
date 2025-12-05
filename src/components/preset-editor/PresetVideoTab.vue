<script setup lang="ts">
import type { VideoConfig } from "@/types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "@/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  video: VideoConfig;
  isCopyEncoder: boolean;
  rateControlLabel: string;
}>();

const video = props.video as any;

const { t } = useI18n();
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-1">
      <Label>{{ t("presetEditor.video.encoder") }}</Label>
      <Select
        :model-value="video.encoder"
        @update:model-value="
          (value) => {
            const next = value as VideoConfig['encoder'];
            video.encoder = next;

            // 简单保持 encoder 与速率控制的组合有效：
            // - NVENC 优先 CQ / VBR；
            // - 其他编码器用 CRF / VBR；
            // - copy 模式不参与编码参数。
            if (next === 'hevc_nvenc') {
              if (!['cq', 'vbr', 'cbr'].includes(video.rateControl)) {
                video.rateControl = 'cq';
              }
            } else if (next === 'copy') {
              video.bitrateKbps = undefined;
              video.maxBitrateKbps = undefined;
              video.bufferSizeKbits = undefined;
              video.pass = undefined;
            } else {
              if (video.rateControl === 'cq') {
                video.rateControl = 'crf';
              }
            }
          }
        "
      >
        <SelectTrigger>
          <SelectValue :placeholder="t('presetEditor.video.encoderPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="opt in ENCODER_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="!props.isCopyEncoder" class="space-y-4">
      <div class="bg-muted/40 p-4 rounded-md border border-border/60">
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium">
            {{ props.rateControlLabel }}
          </span>
          <span class="text-primary font-bold text-lg">
            {{ video.qualityValue }}
          </span>
        </div>
        <Slider
          :min="0"
          :max="video.encoder === 'libsvtav1' ? 63 : 51"
          :step="1"
          :model-value="[video.qualityValue]"
          class="w-full"
          @update:model-value="
            (value) => {
              const v = (value as number[])[0];
              if (typeof v === 'number') {
                video.qualityValue = v;
              }
            }
          "
        />
        <p class="mt-2 text-xs text-muted-foreground">
          <span v-if="video.encoder === 'libx264'">
            {{ t("presetEditor.tips.crf_x264") }}
          </span>
          <span v-else-if="video.encoder === 'hevc_nvenc'">
            {{ t("presetEditor.tips.cq_nvenc") }}
          </span>
          <span v-else-if="video.encoder === 'libsvtav1'">
            {{ t("presetEditor.tips.crf_av1") }}
          </span>
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4 items-start">
        <div class="space-y-1">
          <Label>
            {{ t("presetEditor.video.rateControlModeLabel", "速率控制模式") }}
          </Label>
          <Select
            :model-value="video.rateControl"
            @update:model-value="
              (value) => {
                video.rateControl = value as VideoConfig['rateControl'];
                // 清理与模式不匹配的字段，避免生成互斥参数组合。
                if (video.rateControl === 'crf' || video.rateControl === 'cq') {
                  video.bitrateKbps = undefined;
                  video.maxBitrateKbps = undefined;
                  video.bufferSizeKbits = undefined;
                  video.pass = undefined;
                }
              }
            "
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-if="video.encoder !== 'hevc_nvenc'"
                value="crf"
              >
                CRF
              </SelectItem>
              <SelectItem
                v-else
                value="cq"
              >
                CQ
              </SelectItem>
              <SelectItem value="vbr">
                VBR
              </SelectItem>
              <SelectItem value="cbr">
                CBR
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[10px] text-muted-foreground">
            {{
              t(
                "presetEditor.video.rateControlHelp",
                "CRF/CQ 更偏向画质，CBR/VBR 更偏向可控大小与码率；两者不可同时使用。",
              )
            }}
          </p>
        </div>

        <div class="space-y-1">
          <Label>
            {{ t("presetEditor.video.bitrateKbpsLabel", "目标码率 (kbps)") }}
          </Label>
          <Input
            type="number"
            min="0"
            class="h-8 text-xs"
            :model-value="video.bitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.bitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
          <p class="text-[10px] text-muted-foreground">
            {{
              t(
                "presetEditor.video.bitrateHelp",
                "仅在 CBR/VBR 模式下生效；在 CRF/CQ 模式下会被忽略。",
              )
            }}
          </p>
        </div>
      </div>

      <div
        v-if="video.rateControl === 'vbr' || video.rateControl === 'cbr'"
        class="grid grid-cols-2 gap-4"
      >
        <div class="space-y-1">
          <Label>
            {{ t("presetEditor.video.maxBitrateKbpsLabel", "峰值码率上限 (kbps)") }}
          </Label>
          <Input
            type="number"
            min="0"
            class="h-8 text-xs"
            :model-value="video.maxBitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.maxBitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
          <p class="text-[10px] text-muted-foreground">
            {{
              t(
                "presetEditor.video.maxBitrateKbpsHelp",
                "限制码率尖峰，通常略高于目标码率；设置过低会让复杂场景被压缩得很糊。",
              )
            }}
          </p>
        </div>
        <div class="space-y-1">
          <Label>
            {{ t("presetEditor.video.passLabel", "两遍编码 pass") }}
          </Label>
          <Select
            :model-value="video.pass ? String(video.pass) : 'single'"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                if (value === 'single') {
                  video.pass = undefined;
                } else {
                  video.pass = n === 1 || n === 2 ? (n as 1 | 2) : undefined;
                }
              }
            "
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">
                {{ t("presetEditor.video.passSingle", "单遍编码") }}
              </SelectItem>
              <SelectItem value="1">
                {{ t("presetEditor.video.passFirst", "Pass 1") }}
              </SelectItem>
              <SelectItem value="2">
                {{ t("presetEditor.video.passSecond", "Pass 2") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[10px] text-muted-foreground">
            {{
              t(
                "presetEditor.video.passHelp",
                "两遍编码需要与目标码率同时使用；不支持与 CRF/CQ 组合。",
              )
            }}
          </p>
        </div>
      </div>

      <div class="space-y-1">
        <Label>{{ t("presetEditor.video.presetLabel") }}</Label>
        <Select
          :model-value="video.preset"
          @update:model-value="
            (value) => {
              video.preset = value as string;
            }
          "
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="p in PRESET_OPTIONS[video.encoder]"
              :key="p"
              :value="p"
            >
              {{ p }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

  </div>
</template>
