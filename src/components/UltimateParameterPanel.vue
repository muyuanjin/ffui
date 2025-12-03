<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { AudioConfig, FFmpegPreset, FilterConfig, VideoConfig } from "../types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useI18n } from "vue-i18n";
import { highlightFfmpegCommand, normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";

const props = defineProps<{
  /** Preset being edited in the full parameter panel. */
  initialPreset: FFmpegPreset;
}>();

const emit = defineEmits<{
  (e: "save", value: FFmpegPreset): void;
  (e: "cancel"): void;
  // Allow jumping back to the guided wizard while keeping the edited state.
  (e: "switchToWizard", value: FFmpegPreset): void;
}>();

const { t } = useI18n();

const activeTab = ref<"global" | "input" | "mapping" | "video" | "audio" | "filters" | "container" | "hardware">("video");

const name = ref(props.initialPreset.name);
const description = ref(props.initialPreset.description ?? "");

const video = reactive<VideoConfig>({ ...(props.initialPreset.video as VideoConfig) });
const audio = reactive<AudioConfig>({ ...(props.initialPreset.audio as AudioConfig) });
const filters = reactive<FilterConfig>({ ...(props.initialPreset.filters as FilterConfig) });

const advancedEnabled = ref<boolean>(props.initialPreset.advancedEnabled ?? false);
const ffmpegTemplate = ref<string>(props.initialPreset.ffmpegTemplate ?? "");
const parseHint = ref<string | null>(null);
const parseHintVariant = ref<"neutral" | "ok" | "warning">("neutral");

const isCopyEncoder = computed(() => video.encoder === "copy");

const rateControlLabel = computed(() => {
  if (video.encoder === "hevc_nvenc") {
    return t("presetEditor.video.cqLabel");
  }
  return t("presetEditor.video.crfLabel");
});

const generatedCommand = computed(() => {
  // 与向导保持一致：在结构化模式下根据当前字段拼接一个 ffmpeg 预览命令。
  const inputPlaceholder = "INPUT";
  const outputPlaceholder = "OUTPUT";

  const v = video as VideoConfig;
  const a = audio as AudioConfig;
  const f = filters as FilterConfig;

  const args: string[] = [];

  // input
  args.push("-i", inputPlaceholder);

  // video
  if (v.encoder === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", v.encoder);

    // 速率控制：质量优先（CRF/CQ）与码率优先（CBR/VBR + two-pass）互斥。
    if (v.rateControl === "crf" || v.rateControl === "cq") {
      args.push(v.rateControl === "crf" ? "-crf" : "-cq", String(v.qualityValue));
    } else if (v.rateControl === "cbr" || v.rateControl === "vbr") {
      if (typeof v.bitrateKbps === "number" && v.bitrateKbps > 0) {
        args.push("-b:v", `${v.bitrateKbps}k`);
      }
      if (typeof v.maxBitrateKbps === "number" && v.maxBitrateKbps > 0) {
        args.push("-maxrate", `${v.maxBitrateKbps}k`);
      }
      if (typeof v.bufferSizeKbits === "number" && v.bufferSizeKbits > 0) {
        args.push("-bufsize", `${v.bufferSizeKbits}k`);
      }
      if (v.pass === 1 || v.pass === 2) {
        args.push("-pass", String(v.pass));
      }
    }

    if (v.preset) {
      args.push("-preset", v.preset);
    }
    if (v.tune) {
      args.push("-tune", v.tune);
    }
    if (v.profile) {
      args.push("-profile:v", v.profile);
    }
  }

  // audio
  if (a.codec === "copy") {
    args.push("-c:a", "copy");
  } else if (a.codec === "aac") {
    args.push("-c:a", "aac");
    if (a.bitrate) {
      args.push("-b:a", `${a.bitrate}k`);
    }
  }

  // filters
  const vfParts: string[] = [];
  if (f.scale) {
    vfParts.push(`scale=${f.scale}`);
  }
  if (f.crop) {
    vfParts.push(`crop=${f.crop}`);
  }
  if ((f as any).fps && (f as any).fps > 0) {
    // FilterConfig 当前已经包含 fps，可直接复用。
    vfParts.push(`fps=${(f as any).fps}`);
  }
  if (vfParts.length > 0) {
    args.push("-vf", vfParts.join(","));
  }

  // output
  args.push(outputPlaceholder);

  return ["ffmpeg", ...args].join(" ");
});

const commandPreview = computed(() => {
  if (advancedEnabled.value && ffmpegTemplate.value.trim().length > 0) {
    return ffmpegTemplate.value.trim();
  }
  return generatedCommand.value;
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

const buildPresetFromState = (): FFmpegPreset => {
  const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
  if (normalizedVideo.encoder !== "libx264") {
    delete (normalizedVideo as any).tune;
  }

  return {
    id: props.initialPreset.id,
    name: name.value || (t("presetEditor.untitled") as string),
    description: description.value,
    video: normalizedVideo,
    audio: { ...(audio as AudioConfig) },
    filters: { ...(filters as FilterConfig) },
    advancedEnabled: advancedEnabled.value && ffmpegTemplate.value.trim().length > 0,
    ffmpegTemplate: ffmpegTemplate.value.trim() || undefined,
    stats: props.initialPreset.stats,
  };
};

const handleSave = () => {
  emit("save", buildPresetFromState());
};

const handleSwitchToWizard = () => {
  emit("switchToWizard", buildPresetFromState());
};

const handleParseTemplateFromCommand = () => {
  const source = ffmpegTemplate.value.trim() || generatedCommand.value;
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
      class="bg-background w-full max-w-5xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]"
    >
      <div class="p-6 border-b border-border flex justify-between items-center">
        <div>
          <h2 class="text-xl font-bold text-white">
            {{ t("presetEditor.panel.title", "预设参数面板") }}
          </h2>
          <p class="text-muted-foreground text-xs mt-1">
            {{
              t(
                "presetEditor.panel.subtitle",
                "按分区完整调整 FFmpeg 参数；右侧随时预览最终命令。",
              )
            }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 px-3 text-[11px]"
            @click="handleSwitchToWizard"
          >
            {{ t("presetEditor.actions.backToWizard", "返回向导视图") }}
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

      <Tabs
        v-model="activeTab"
        class="flex-1 flex min-h-0"
      >
        <div class="w-52 border-r border-border/60 bg-muted/40 p-4">
          <TabsList class="flex flex-col items-stretch gap-1 bg-transparent p-0">
            <TabsTrigger
              value="global"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.globalTab", "全局与日志") }}
            </TabsTrigger>
            <TabsTrigger
              value="input"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.inputTab", "输入与时间轴") }}
            </TabsTrigger>
            <TabsTrigger
              value="mapping"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.mappingTab", "映射与元数据") }}
            </TabsTrigger>
            <TabsTrigger
              value="video"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.videoTab", "视频编码") }}
            </TabsTrigger>
            <TabsTrigger
              value="audio"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.audioTab", "音频与字幕") }}
            </TabsTrigger>
            <TabsTrigger
              value="filters"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.filtersTab", "滤镜链") }}
            </TabsTrigger>
            <TabsTrigger
              value="container"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.containerTab", "容器与分片") }}
            </TabsTrigger>
            <TabsTrigger
              value="hardware"
              class="justify-start w-full text-xs"
            >
              {{ t("presetEditor.panel.hardwareTab", "硬件与比特流") }}
            </TabsTrigger>
          </TabsList>
        </div>

        <div class="flex-1 flex min-h-0">
          <div class="flex-1 p-6 overflow-y-auto space-y-4">
            <TabsContent
              value="global"
              class="mt-0"
            >
              <div class="space-y-4 text-xs text-muted-foreground">
                <p>
                  {{
                    t(
                      "presetEditor.panel.globalHelp",
                      "全局参数（loglevel/report/stats 等）当前使用 ffmpeg 默认值，后续可在此处补充更多控制项。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="input"
              class="mt-0"
            >
              <div class="space-y-4 text-xs text-muted-foreground">
                <p>
                  {{
                    t(
                      "presetEditor.panel.inputHelp",
                      "输入与时间轴（-ss/-to/-t/-accurate_seek 等）后续会作为一等公民参数加入，此版本暂保留默认行为。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="mapping"
              class="mt-0"
            >
              <div class="space-y-4 text-xs text-muted-foreground">
                <p>
                  {{
                    t(
                      "presetEditor.panel.mappingHelp",
                      "映射与元数据（-map/-map_metadata/-disposition 等）暂保持自动映射，未来版本会提供精细控制。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="video"
              class="mt-0 space-y-4"
            >
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

              <div v-if="!isCopyEncoder" class="space-y-4">
                <div class="bg-muted/40 p-4 rounded-md border border-border/60">
                  <div class="flex justify-between items-center mb-2">
                    <span class="font-medium">
                      {{ rateControlLabel }}
                    </span>
                    <span class="text-primary font-bold text-lg">
                      {{ video.qualityValue }}
                    </span>
                  </div>
                  <input
                    type="range"
                    class="w-full"
                    :min="0"
                    :max="video.encoder === 'libsvtav1' ? 63 : 51"
                    :step="1"
                    :value="video.qualityValue"
                    @input="
                      (event) => {
                        const target = event.target as HTMLInputElement;
                        video.qualityValue = Number(target.value);
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
            </TabsContent>

            <TabsContent
              value="audio"
              class="mt-0 space-y-4"
            >
              <div class="bg-muted/40 p-4 rounded-md border border-border/60">
                <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
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
            </TabsContent>

            <TabsContent
              value="filters"
              class="mt-0 space-y-4"
            >
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
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="container"
              class="mt-0"
            >
              <div class="space-y-4 text-xs text-muted-foreground">
                <p>
                  {{
                    t(
                      "presetEditor.panel.containerHelp",
                      "容器与分片（-f/-movflags/-segment_*/-hls_* 等）暂沿用输出文件扩展名推断，后续迭代会在此处暴露关键开关。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="hardware"
              class="mt-0"
            >
              <div class="space-y-4 text-xs text-muted-foreground">
                <p>
                  {{
                    t(
                      "presetEditor.panel.hardwareHelp",
                      "硬件加速与比特流过滤（hwaccel/bsf 等）当前通过预设 encoder 隐式选择，未来会在此处提供更细粒度的选项。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>
          </div>

          <div class="w-80 border-l border-border/60 bg-muted/40 p-4 flex flex-col gap-3">
            <h3 class="text-xs font-semibold text-foreground border-b border-border/60 pb-2">
              {{ t("presetEditor.advanced.previewTitle") }}
            </h3>
            <pre
              class="flex-1 rounded-md bg-background/90 border border-border/60 px-2 py-2 text-[11px] font-mono text-muted-foreground overflow-x-auto overflow-y-auto select-text"
              v-html="highlightedCommandHtml"
            />
            <p :class="parseHintClass">
              {{
                parseHint ||
                  "INPUT / OUTPUT 占位符会在实际执行时被具体路径替换；参数面板中的更改会实时反映到预览。"
              }}
            </p>
            <div class="space-y-1 mt-2">
              <Label class="text-[11px]">
                {{ t("presetEditor.advanced.templateLabel") }}
              </Label>
              <Textarea
                v-model="ffmpegTemplate"
                :placeholder="t('presetEditor.advanced.templatePlaceholder')"
                class="min-h-[60px] text-[11px] font-mono"
              />
              <label class="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                <input
                  v-model="advancedEnabled"
                  type="checkbox"
                  class="h-3 w-3 rounded border-border bg-background"
                />
                <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
              </label>
              <Button
                variant="ghost"
                size="sm"
                class="mt-1 h-6 px-0 justify-start text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                @click="handleParseTemplateFromCommand"
              >
                {{ t("presetEditor.advanced.parseButton", "从完整命令智能提取 INPUT / OUTPUT 占位符") }}
              </Button>
            </div>
          </div>
        </div>
      </Tabs>

      <div class="p-4 border-t border-border bg-muted/60 flex justify-between items-center">
        <Button
          variant="ghost"
          class="px-4 py-2 text-muted-foreground hover:text-foreground font-medium"
          @click="emit('cancel')"
        >
          {{ t("common.cancel", "取消") }}
        </Button>
        <Button
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          @click="handleSave"
        >
          {{ t("presetEditor.actions.update", "保存预设") }}
        </Button>
      </div>
    </div>
  </div>
</template>
