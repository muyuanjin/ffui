<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { AudioConfig, EncoderType, FFmpegPreset, FilterConfig, VideoConfig } from "../types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";
import {
  highlightFfmpegCommand,
  normalizeFfmpegTemplate,
  getFfmpegCommandPreview,
} from "@/lib/ffmpegCommand";

const props = defineProps<{
  initialPreset?: FFmpegPreset | null;
}>();

const emit = defineEmits<{
  (e: "save", value: FFmpegPreset): void;
  (e: "cancel"): void;
  // When editing an existing preset, allow switching to the full parameter panel
  // while preserving the current wizard state.
  (e: "switchToPanel", value: FFmpegPreset): void;
}>();

const { t } = useI18n();

const step = ref(1);
const name = ref(props.initialPreset?.name ?? "");
const description = ref(props.initialPreset?.description ?? "");

const defaultVideo: VideoConfig = {
  encoder: "libx264",
  rateControl: "crf",
  qualityValue: 23,
  preset: "medium",
  tune: "film",
};

const video = reactive<VideoConfig>({
  ...(props.initialPreset?.video ?? defaultVideo),
});
const audio = reactive<AudioConfig>({
  ...(props.initialPreset?.audio ?? {
    codec: "copy",
    bitrate: 192,
  }),
});
const filters = reactive<FilterConfig>({
  ...(props.initialPreset?.filters ?? {}),
});

const advancedEnabled = ref<boolean>(props.initialPreset?.advancedEnabled ?? false);
const ffmpegTemplate = ref<string>(props.initialPreset?.ffmpegTemplate ?? "");
const parseHint = ref<string | null>(null);
const parseHintVariant = ref<"neutral" | "ok" | "warning">("neutral");

const handleEncoderChange = (newEncoder: EncoderType) => {
  let defaults: Partial<VideoConfig> = {};

  if (newEncoder === "libx264") {
    defaults = {
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
      tune: "film",
      profile: undefined,
    };
  } else if (newEncoder === "hevc_nvenc") {
    // NVENC 不支持 x264 的 -tune film 等参数，切换编码器时清理 tune / profile。
    defaults = {
      rateControl: "cq",
      qualityValue: 28,
      preset: "p5",
      tune: undefined,
      profile: undefined,
    };
  } else if (newEncoder === "libsvtav1") {
    defaults = {
      rateControl: "crf",
      qualityValue: 34,
      preset: "5",
      tune: undefined,
      profile: undefined,
    };
  } else if (newEncoder === "copy") {
    Object.assign(audio, { codec: "copy" });
    defaults = {
      rateControl: "cbr",
      qualityValue: 0,
      preset: "",
      tune: undefined,
      profile: undefined,
    };
  }

  Object.assign(video, {
    encoder: newEncoder,
    ...defaults,
  });
};

const buildPresetFromState = (): FFmpegPreset => {
  // 防止把 x264 的 tune 选项带到 NVENC/AV1 预设里，从而生成非法 ffmpeg 参数。
  const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
  if (normalizedVideo.encoder !== "libx264") {
    delete (normalizedVideo as any).tune;
  }

  const newPreset: FFmpegPreset = {
    id: props.initialPreset?.id ?? Date.now().toString(),
    name: name.value || (t("presetEditor.untitled") as string),
    description: description.value,
    video: normalizedVideo,
    audio: { ...audio } as AudioConfig,
    filters: { ...filters } as FilterConfig,
    advancedEnabled: advancedEnabled.value && ffmpegTemplate.value.trim().length > 0,
    ffmpegTemplate: ffmpegTemplate.value.trim() || undefined,
    stats:
      props.initialPreset?.stats ?? {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
  };

  return newPreset;
};

const handleSave = () => {
  emit("save", buildPresetFromState());
};

const handleSwitchToPanel = () => {
  emit("switchToPanel", buildPresetFromState());
};

const isCopyEncoder = computed(() => video.encoder === "copy");

const rateControlLabel = computed(() => {
  if (video.encoder === "hevc_nvenc") {
    return t("presetEditor.video.cqLabel");
  }
  return t("presetEditor.video.crfLabel");
});

const commandPreview = computed(() => {
  return getFfmpegCommandPreview({
    video: video as VideoConfig,
    audio: audio as AudioConfig,
    filters: filters as FilterConfig,
    advancedEnabled: advancedEnabled.value,
    ffmpegTemplate: ffmpegTemplate.value,
  });
});

const highlightedCommandHtml = computed(() => highlightFfmpegCommand(commandPreview.value));

const parseHintClass = computed(() => {
  if (!parseHint.value) {
    return "text-[10px] text-muted-foreground";
  }
  if (parseHintVariant.value === "ok") {
    return "text-[10px] text-emerald-400";
  }
  if (parseHintVariant.value === "warning") {
    return "text-[10px] text-amber-400";
  }
  return "text-[10px] text-muted-foreground";
});

const handleCopyPreview = async () => {
  try {
    await navigator.clipboard?.writeText(commandPreview.value);
    // silent success; in future can wire to toast using t("presetEditor.advanced.copiedToast")
  } catch {
    // ignore clipboard failures
  }
};

const handleParseTemplateFromCommand = () => {
  const source =
    ffmpegTemplate.value.trim() ||
    getFfmpegCommandPreview({
      video: video as VideoConfig,
      audio: audio as AudioConfig,
      filters: filters as FilterConfig,
      advancedEnabled: false,
      ffmpegTemplate: "",
    });
  if (!source) {
    parseHint.value =
      (t("presetEditor.advanced.parseEmpty") as string) ||
      "请先在上方输入一条完整的 ffmpeg 命令，再尝试解析。";
    parseHintVariant.value = "warning";
    return;
  }

  const result = normalizeFfmpegTemplate(source);
  ffmpegTemplate.value = result.template;
  advancedEnabled.value = true;

  if (result.inputReplaced && result.outputReplaced) {
    parseHint.value =
      (t("presetEditor.advanced.parseOk") as string) ||
      "已识别并替换命令中的输入/输出路径为 INPUT / OUTPUT 占位符。";
    parseHintVariant.value = "ok";
  } else if (result.inputReplaced || result.outputReplaced) {
    parseHint.value =
      (t("presetEditor.advanced.parsePartial") as string) ||
      "只识别到部分输入/输出参数，请检查命令并手动将剩余路径替换为 INPUT / OUTPUT。";
    parseHintVariant.value = "warning";
  } else {
    parseHint.value =
      (t("presetEditor.advanced.parseFailed") as string) ||
      "未能自动识别输入/输出路径，请确保包含 -i <输入> 和输出文件路径，或直接手动将对应部分替换为 INPUT / OUTPUT。";
    parseHintVariant.value = "warning";
  }
};
</script>

<template>
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div
      class="bg-background w-full max-w-2xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]"
    >
      <div class="p-6 border-b border-border flex justify-between items-center">
        <div>
          <h2 class="text-xl font-bold text-white">
            {{ initialPreset ? t("presetEditor.titleEdit") : t("presetEditor.titleNew") }}
          </h2>
          <p class="text-muted-foreground text-sm">
            {{ t("common.stepOf", { step, total: 5 }) }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 px-3 text-[11px]"
            data-testid="preset-open-panel"
            @click="handleSwitchToPanel"
          >
            {{ t("presetEditor.actions.openPanel", '完整参数面板') }}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground hover:text-foreground"
            @click="emit('cancel')"
          >
            ✕
          </Button>
        </div>
      </div>

      <div class="p-6 overflow-y-auto flex-1 space-y-6">
        <template v-if="step === 1">
          <div class="space-y-6">
            <div class="space-y-1">
              <Label for="preset-name">
                {{ t("presetEditor.name") }}
              </Label>
              <Input
                id="preset-name"
                v-model="name"
                :placeholder="t('presetEditor.namePlaceholder')"
              />
            </div>
            <div class="space-y-1">
              <Label for="preset-description">
                {{ t("presetEditor.description") }}
              </Label>
              <Textarea
                id="preset-description"
                v-model="description"
                :placeholder="t('presetEditor.descriptionPlaceholder')"
                class="min-h-[96px]"
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
                    () => {
                      name = t('presetEditor.recipes.hqArchive');
                      description = 'x264 Slow CRF 18. Visually lossless.';
                      Object.assign(video, {
                        encoder: 'libx264',
                        rateControl: 'crf',
                        qualityValue: 18,
                        preset: 'slow',
                        tune: 'film',
                        profile: undefined,
                      } as VideoConfig);
                      step = 2;
                    }
                  "
                >
                  {{ t("presetEditor.recipes.hqArchive") }}
                </Button>
                <Button
                  variant="outline"
                  class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
                  @click="
                    () => {
                      name = t('presetEditor.recipes.fastTranscode');
                      description = 'NVENC H.265. Fast conversion for devices.';
                      Object.assign(video, {
                        encoder: 'hevc_nvenc',
                        rateControl: 'cq',
                        qualityValue: 28,
                        preset: 'p5',
                        tune: undefined,
                        profile: undefined,
                      } as VideoConfig);
                      step = 2;
                    }
                  "
                >
                  {{ t("presetEditor.recipes.fastTranscode") }}
                </Button>
                <Button
                  variant="outline"
                  class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
                  @click="
                    () => {
                      name = t('presetEditor.recipes.modernAv1');
                      description = 'High efficiency AV1 encoding.';
                      Object.assign(video, {
                        encoder: 'libsvtav1',
                        rateControl: 'crf',
                        qualityValue: 34,
                        preset: '6',
                        tune: undefined,
                        profile: undefined,
                      } as VideoConfig);
                      step = 2;
                    }
                  "
                >
                  {{ t("presetEditor.recipes.modernAv1") }}
                </Button>
                <Button
                  variant="outline"
                  class="justify-start text-sm h-10 px-3 bg-card/40 border-border/60 hover:bg-card/80 hover:border-primary/60 text-foreground"
                  @click="
                    () => {
                      name = t('presetEditor.recipes.streamCopy');
                      description = 'No re-encode, remux only.';
                      Object.assign(video, {
                        encoder: 'copy',
                        rateControl: 'cbr',
                        qualityValue: 0,
                        preset: 'copy',
                        tune: undefined,
                        profile: undefined,
                      } as VideoConfig);
                      audio.codec = 'copy';
                      step = 2;
                    }
                  "
                >
                  {{ t("presetEditor.recipes.streamCopy") }}
                </Button>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="step === 2">
          <div class="space-y-6">
            <div class="space-y-1">
              <Label>{{ t("presetEditor.video.encoder") }}</Label>
              <Select
                :model-value="video.encoder"
                @update:model-value="(value) => handleEncoderChange(value as EncoderType)"
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
              <p
                v-if="isCopyEncoder"
                class="text-amber-400 text-xs mt-1 flex items-center gap-1"
              >
                {{ t("presetEditor.video.copyWarning") }}
              </p>
            </div>

            <div v-if="!isCopyEncoder" class="space-y-6">
              <div class="bg-muted/40 p-4 rounded-md border border-border/60">
                <div class="flex justify-between items-center mb-2">
                  <span class="font-medium">
                    {{ rateControlLabel }}
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
                  class="mt-3"
                  @update:model-value="
                    (value) => {
                      const next = (value as number[])[0];
                      if (typeof next === 'number') video.qualityValue = next;
                    }
                  "
                />
                <div class="mt-2 text-xs text-muted-foreground flex gap-2 items-start">
                  <span class="text-primary mt-0.5">ℹ</span>
                  <p>
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
                <div class="mt-1 text-xs text-muted-foreground">
                  <span v-if="video.encoder === 'libx264'">
                    {{ t("presetEditor.tips.preset_x264") }}
                  </span>
                  <span v-else-if="video.encoder === 'hevc_nvenc'">
                    {{ t("presetEditor.tips.preset_nvenc") }}
                  </span>
                  <span v-else-if="video.encoder === 'libsvtav1'">
                    {{ t("presetEditor.tips.preset_av1") }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="step === 3">
          <!-- Step 3 – 分辨率与基础滤镜 -->
          <div class="space-y-6">
            <div
              v-if="!isCopyEncoder"
              class="bg-muted/40 p-4 rounded-md border border-border/60"
            >
              <h3 class="font-semibold mb-4 border-b border-border/60 pb-2">
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
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="step === 4">
          <!-- Step 4 – 音频与字幕（当前仅实现音频策略，字幕后续扩展） -->
          <div class="space-y-6">
            <div class="bg-muted/40 p-4 rounded-md border border-border/60">
              <h3 class="font-semibold mb-4 border-b border-border/60 pb-2">
                {{ t("presetEditor.audio.title") }}
              </h3>
              <div class="space-y-4">
                <div class="flex gap-4">
                  <Button
                    :variant="audio.codec === 'copy' ? 'default' : 'outline'"
                    class="flex-1 flex flex-col items-start gap-1 h-auto"
                    @click="audio.codec = 'copy'"
                  >
                    <span class="block font-bold">
                      {{ t("presetEditor.audio.copyTitle") }}
                    </span>
                    <span class="text-xs text-muted-foreground">
                      {{ t("presetEditor.audio.copyDesc") }}
                    </span>
                  </Button>
                  <Button
                    :variant="audio.codec === 'aac' ? 'default' : 'outline'"
                    class="flex-1 flex flex-col items-start gap-1 h-auto"
                    :disabled="isCopyEncoder"
                    :aria-disabled="isCopyEncoder"
                    @click="audio.codec = 'aac'"
                  >
                    <span class="block font-bold">
                      {{ t("presetEditor.audio.aacTitle") }}
                    </span>
                    <span class="text-xs text-muted-foreground">
                      {{ t("presetEditor.audio.aacDesc") }}
                    </span>
                  </Button>
                </div>
                <div v-if="audio.codec === 'aac'">
                  <Label class="block text-xs mb-1">
                    {{ t("presetEditor.audio.bitrateLabel") }}
                  </Label>
                  <Select
                    :model-value="String(audio.bitrate)"
                    @update:model-value="
                      (value) => {
                        const parsed = Number(value as string);
                        if (!Number.isNaN(parsed)) audio.bitrate = parsed;
                      }
                    "
                  >
                    <SelectTrigger class="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="128">
                        {{ t("presetEditor.audio.bitrate128") }}
                      </SelectItem>
                      <SelectItem value="192">
                        {{ t("presetEditor.audio.bitrate192") }}
                      </SelectItem>
                      <SelectItem value="320">
                        {{ t("presetEditor.audio.bitrate320") }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="mt-1 text-[11px] text-muted-foreground">
                    {{ t("presetEditor.audio.bitrateHelp") }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <!-- Step 5 – Summary + 预览（含高级模板模式） -->
          <div class="space-y-6">
            <div class="bg-muted/40 p-4 rounded-md border border-border/60">
              <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
                {{ t("presetEditor.summary.title", '预设概览') }}
              </h3>
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div class="text-[10px] text-muted-foreground uppercase mb-1">
                    {{ t("presets.videoLabel", '视频') }}
                  </div>
                  <div class="font-mono text-foreground">
                    {{ video.encoder }} · {{ video.rateControl.toUpperCase() }} {{ video.qualityValue }}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] text-muted-foreground uppercase mb-1">
                    {{ t("presets.audioLabel", '音频') }}
                  </div>
                  <div class="font-mono text-foreground">
                    <span v-if="audio.codec === 'copy'">
                      {{ t("presets.audioCopy", 'copy') }}
                    </span>
                    <span v-else>
                      AAC {{ audio.bitrate ?? 0 }}k
                    </span>
                  </div>
                </div>
                <div v-if="filters.scale">
                  <div class="text-[10px] text-muted-foreground uppercase mb-1">
                    {{ t("presetEditor.filters.title", '滤镜') }}
                  </div>
                  <div class="font-mono text-foreground">
                    scale={{ filters.scale }}
                  </div>
                </div>
              </div>
            </div>

            <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="font-semibold">
                    {{ t("presetEditor.advanced.title") }}
                  </h3>
                  <p class="text-xs text-muted-foreground mt-1">
                    {{ t("presetEditor.advanced.description") }}
                  </p>
                </div>
                <label class="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    v-model="advancedEnabled"
                    type="checkbox"
                    class="h-3 w-3 rounded border-border bg-background"
                  />
                  <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
                </label>
              </div>

              <div class="space-y-1">
                <Label class="text-xs">
                  {{ t("presetEditor.advanced.templateLabel") }}
                </Label>
                <Textarea
                  v-model="ffmpegTemplate"
                  :placeholder="t('presetEditor.advanced.templatePlaceholder')"
                  class="min-h-[80px] text-xs font-mono"
                />
              </div>

              <div class="space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs text-muted-foreground">
                    {{ t("presetEditor.advanced.previewTitle") }}
                  </span>
                  <div class="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      @click="handleParseTemplateFromCommand"
                    >
                      {{ t("presetEditor.advanced.parseButton", "智能解析命令") }}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      @click="handleCopyPreview"
                    >
                      {{ t("presetEditor.advanced.copyButton") }}
                    </Button>
                  </div>
                </div>
                <pre
                  class="mt-1 rounded-md bg-background/80 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
                  v-html="highlightedCommandHtml"
                />
                <p :class="parseHintClass" class="mt-1">
                  {{
                    parseHint ||
                      "INPUT / OUTPUT 会在实际执行时被具体路径替换；如果从完整命令粘贴，请优先在此处解析并替换占位符。"
                  }}
                </p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="p-6 border-t border-border bg-muted/60 flex justify-between rounded-b-xl">
        <Button
          v-if="step > 1"
          variant="ghost"
          class="px-4 py-2 text-muted-foreground hover:text-foreground font-medium"
          @click="step -= 1"
        >
          {{ t("common.back") }}
        </Button>
        <div v-else />

        <Button
          v-if="step < 5"
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          @click="step += 1"
        >
          {{ t("common.next") }} →
        </Button>
        <Button
          v-else
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          @click="handleSave"
        >
          {{ initialPreset ? t("presetEditor.actions.update") : t("presetEditor.actions.save") }}
        </Button>
      </div>
    </div>
  </div>
</template>
