<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type {
  AudioConfig,
  ContainerConfig,
  FFmpegPreset,
  FilterConfig,
  GlobalConfig,
  HardwareConfig,
  InputTimelineConfig,
  LogLevel,
  MappingConfig,
  SubtitlesConfig,
  VideoConfig,
} from "../types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";
import {
  highlightFfmpegCommand,
  normalizeFfmpegTemplate,
  getFfmpegCommandPreview,
} from "@/lib/ffmpegCommand";

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

const activeTab = ref<
  "global" | "input" | "mapping" | "video" | "audio" | "filters" | "container" | "hardware"
>("video");

const name = ref(props.initialPreset.name);
const description = ref(props.initialPreset.description ?? "");

const globalConfig = reactive<GlobalConfig>({ ...(props.initialPreset.global ?? {}) });
const inputTimeline = reactive<InputTimelineConfig>({ ...(props.initialPreset.input ?? {}) });
const mapping = reactive<MappingConfig>({ ...(props.initialPreset.mapping ?? {}) });
const video = reactive<VideoConfig>({ ...(props.initialPreset.video as VideoConfig) });
const audio = reactive<AudioConfig>({ ...(props.initialPreset.audio as AudioConfig) });
const filters = reactive<FilterConfig>({ ...(props.initialPreset.filters as FilterConfig) });
const subtitles = reactive<SubtitlesConfig>({ ...(props.initialPreset.subtitles ?? {}) });
const container = reactive<ContainerConfig>({ ...(props.initialPreset.container ?? {}) });
const hardware = reactive<HardwareConfig>({ ...(props.initialPreset.hardware ?? {}) });

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

const commandPreview = computed(() => {
  return getFfmpegCommandPreview({
    global: globalConfig as GlobalConfig,
    input: inputTimeline as InputTimelineConfig,
    mapping: mapping as MappingConfig,
    video: video as VideoConfig,
    audio: audio as AudioConfig,
    filters: filters as FilterConfig,
    subtitles: subtitles as SubtitlesConfig,
    container: container as ContainerConfig,
    hardware: hardware as HardwareConfig,
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

const buildPresetFromState = (): FFmpegPreset => {
  const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
  if (normalizedVideo.encoder !== "libx264") {
    delete (normalizedVideo as any).tune;
  }

  return {
    id: props.initialPreset.id,
    name: name.value || (t("presetEditor.untitled") as string),
    description: description.value,
    global: { ...(globalConfig as GlobalConfig) },
    input: { ...(inputTimeline as InputTimelineConfig) },
    mapping: { ...(mapping as MappingConfig) },
    video: normalizedVideo,
    audio: { ...(audio as AudioConfig) },
    filters: { ...(filters as FilterConfig) },
    subtitles: { ...(subtitles as SubtitlesConfig) },
    container: { ...(container as ContainerConfig) },
    hardware: { ...(hardware as HardwareConfig) },
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
      class="bg-background w-full max-w-5xl rounded-xl shadow-2xl border border-border flex flex-col h-[min(640px,90vh)]"
      data-ffui-parameter-panel="root"
    >
      <div class="p-6 border-b border-border flex justify-between items-center">
        <div>
          <h2 class="text-xl font-bold text-white">
            {{ t("presetEditor.panel.title", "参数详情") }}
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
              class="mt-0 space-y-4"
            >
              <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
                <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
                  {{ t("presetEditor.panel.globalTitle", "全局参数与日志行为") }}
                </h3>

                <div class="space-y-2">
                  <Label class="text-xs">
                    {{ t("presetEditor.panel.overwriteBehaviorLabel", "输出文件覆盖策略") }}
                  </Label>
                  <Select
                    :model-value="globalConfig.overwriteBehavior ?? 'ask'"
                    @update:model-value="(value) => { globalConfig.overwriteBehavior = value as any; }"
                  >
                    <SelectTrigger class="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">
                        {{ t("presetEditor.panel.overwriteAsk", "遵循 ffmpeg 默认（通常询问或失败）") }}
                      </SelectItem>
                      <SelectItem value="overwrite">
                        {{ t("presetEditor.panel.overwriteYes", "自动覆盖已存在输出 (-y)") }}
                      </SelectItem>
                      <SelectItem value="noOverwrite">
                        {{ t("presetEditor.panel.overwriteNo", "从不覆盖已存在输出 (-n)") }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="text-[11px] text-muted-foreground">
                    {{
                      t(
                        "presetEditor.panel.overwriteHelp",
                        "建议保持默认，只有在明确需要自动覆盖输出文件时才启用 -y。",
                      )
                    }}
                  </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.logLevelLabel", "日志等级 (-loglevel)") }}
                    </Label>
                    <Select
                      :model-value="globalConfig.logLevel ?? ''"
                      @update:model-value="
                        (value) => {
                          const raw = value == null ? '' : String(value);
                          if (!raw) {
                            globalConfig.logLevel = undefined;
                          } else {
                            globalConfig.logLevel = raw as LogLevel;
                          }
                        }
                      "
                    >
                      <SelectTrigger class="h-8 text-xs">
                        <SelectValue
                          :placeholder="t('presetEditor.panel.logLevelPlaceholder', '使用 ffmpeg 默认')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quiet">quiet</SelectItem>
                        <SelectItem value="panic">panic</SelectItem>
                        <SelectItem value="fatal">fatal</SelectItem>
                        <SelectItem value="error">error</SelectItem>
                        <SelectItem value="warning">warning</SelectItem>
                        <SelectItem value="info">info</SelectItem>
                        <SelectItem value="verbose">verbose</SelectItem>
                        <SelectItem value="debug">debug</SelectItem>
                        <SelectItem value="trace">trace</SelectItem>
                      </SelectContent>
                    </Select>
                    <p class="text-[11px] text-muted-foreground">
                      {{
                        t(
                          "presetEditor.panel.logLevelHelp",
                          "大多数场景使用 info 即可；调试复杂问题时可以提升到 verbose/debug。",
                        )
                      }}
                    </p>
                  </div>

                  <div class="flex flex-col gap-2 pt-5">
                    <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        v-model="globalConfig.hideBanner"
                        type="checkbox"
                        class="h-3 w-3 rounded border-border bg-background"
                      />
                      <span>
                        {{ t("presetEditor.panel.hideBannerLabel", "隐藏启动 banner (-hide_banner)") }}
                      </span>
                    </label>
                    <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        v-model="globalConfig.enableReport"
                        type="checkbox"
                        class="h-3 w-3 rounded border-border bg-background"
                      />
                      <span>
                        {{ t("presetEditor.panel.enableReportLabel", "在当前目录生成 ffmpeg 报告 (-report)") }}
                      </span>
                    </label>
                  </div>
                </div>

                <p class="text-[11px] text-muted-foreground">
                  {{
                    t(
                      "presetEditor.panel.globalHelp",
                      "这些选项影响所有输入/输出与日志行为，不会改变转码质量本身；如无特殊需求可保持默认。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="input"
              class="mt-0 space-y-4"
            >
              <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
                <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
                  {{ t("presetEditor.panel.inputTitle", "输入与时间轴") }}
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.seekModeLabel", "起始时间 (-ss)") }}
                    </Label>
                    <Select
                      :model-value="inputTimeline.seekMode ?? 'output'"
                      @update:model-value="(value) => { inputTimeline.seekMode = value as any; }"
                    >
                      <SelectTrigger class="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="output">
                          {{ t("presetEditor.panel.seekModeOutput", "在 -i 之后（精确裁剪，稍慢）") }}
                        </SelectItem>
                        <SelectItem value="input">
                          {{ t("presetEditor.panel.seekModeInput", "在 -i 之前（快速跳转，可能不精确）") }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.seekPositionLabel", "起始时间表达式") }}
                    </Label>
                    <Input
                      :model-value="inputTimeline.seekPosition ?? ''"
                      :placeholder="t('presetEditor.panel.seekPositionPlaceholder', '例如 00:01:23.000 或 90')"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          inputTimeline.seekPosition = v || undefined;
                        }
                      "
                    />
                    <p class="text-[11px] text-muted-foreground">
                      {{
                        t(
                          "presetEditor.panel.seekPositionHelp",
                          "格式支持 [[hh:]mm:]ss[.ms] 或纯秒数；仅在字段非空时才会生成 -ss。",
                        )
                      }}
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-2">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.durationModeLabel", "裁剪方式 (-t / -to)") }}
                    </Label>
                    <Select
                      :model-value="inputTimeline.durationMode ?? ''"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          inputTimeline.durationMode = (v || undefined) as any;
                        }
                      "
                    >
                      <SelectTrigger class="h-8 text-xs">
                        <SelectValue
                          :placeholder="t('presetEditor.panel.durationModePlaceholder', '不限制时长（默认）')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="duration">
                          {{ t("presetEditor.panel.durationModeDuration", "指定输出时长 (-t)") }}
                        </SelectItem>
                        <SelectItem value="to">
                          {{ t("presetEditor.panel.durationModeTo", "指定结束时间点 (-to)") }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div class="space-y-2">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.durationLabel", "时长/结束时间表达式") }}
                    </Label>
                    <Input
                      :model-value="inputTimeline.duration ?? ''"
                      :placeholder="t('presetEditor.panel.durationPlaceholder', '例如 00:00:30 或 30')"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          inputTimeline.duration = v || undefined;
                        }
                      "
                    />
                  </div>
                </div>

                <label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    v-model="inputTimeline.accurateSeek"
                    type="checkbox"
                    class="h-3 w-3 rounded border-border bg-background"
                  />
                  <span>
                    {{
                      t(
                        "presetEditor.panel.accurateSeekLabel",
                        "启用 -accurate_seek（更精确的寻址，可能稍慢）",
                      )
                    }}
                  </span>
                </label>

                <p class="text-[11px] text-muted-foreground">
                  {{
                    t(
                      "presetEditor.panel.inputHelp",
                      "起始时间与裁剪设置只在相应字段非空时生效；如不确定，可保留默认设置使用整段视频。",
                    )
                  }}
                </p>
              </div>
            </TabsContent>

            <TabsContent
              value="mapping"
              class="mt-0 space-y-4"
            >
              <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
                <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
                  {{ t("presetEditor.panel.mappingTitle", "流映射与元数据") }}
                </h3>

                <div class="space-y-2">
                  <Label class="text-xs">
                    {{ t("presetEditor.panel.mapLabel", "显式 -map 规则（每行一条）") }}
                  </Label>
                  <Textarea
                    :model-value="(mapping.maps ?? []).join('\n')"
                    :placeholder="t('presetEditor.panel.mapPlaceholder', '例如 0:v:0\\n0:a:0? 保留第一路视频与音频')"
                    class="min-h-[72px] text-[11px] font-mono"
                    @update:model-value="
                      (value) => {
                        const text = String(value ?? '');
                        const lines = text
                          .split('\n')
                          .map((v) => v.trim())
                          .filter((v) => v.length > 0);
                        mapping.maps = lines.length > 0 ? lines : undefined;
                      }
                    "
                  />
                </div>

                <div class="space-y-2">
                  <Label class="text-xs">
                    {{ t("presetEditor.panel.dispositionLabel", "-disposition 规则（每行一条）") }}
                  </Label>
                  <Textarea
                    :model-value="(mapping.dispositions ?? []).join('\n')"
                    :placeholder="t('presetEditor.panel.dispositionPlaceholder', '例如 0:v:0 default\\n0:a:0 default')"
                    class="min-h-[60px] text-[11px] font-mono"
                    @update:model-value="
                      (value) => {
                        const text = String(value ?? '');
                        const lines = text
                          .split('\n')
                          .map((v) => v.trim())
                          .filter((v) => v.length > 0);
                        mapping.dispositions = lines.length > 0 ? lines : undefined;
                      }
                    "
                  />
                </div>

                <div class="space-y-2">
                  <Label class="text-xs">
                    {{ t("presetEditor.panel.metadataLabel", "-metadata 键值对（每行 key=value）") }}
                  </Label>
                  <Textarea
                    :model-value="(mapping.metadata ?? []).join('\n')"
                    :placeholder="t('presetEditor.panel.metadataPlaceholder', 'title=My Video\\nartist=Someone')"
                    class="min-h-[60px] text-[11px] font-mono"
                    @update:model-value="
                      (value) => {
                        const text = String(value ?? '');
                        const lines = text
                          .split('\n')
                          .map((v) => v.trim())
                          .filter((v) => v.length > 0);
                        mapping.metadata = lines.length > 0 ? lines : undefined;
                      }
                    "
                  />
                </div>

                <p class="text-[11px] text-muted-foreground">
                  {{
                    t(
                      "presetEditor.panel.mappingHelp",
                      "若不填写，ffmpeg 会使用默认映射行为；只有在需要精细控制轨道与元数据时才建议手动配置。",
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
                  <div v-if="audio.codec === 'aac'" class="space-y-3">
                    <div>
                      <Label class="block text-xs mb-1">
                        {{ t("presetEditor.audio.bitrateLabel") }}
                      </Label>
                      <Select
                        :model-value="audio.bitrate != null ? String(audio.bitrate) : ''"
                        @update:model-value="
                          (value) => {
                            const parsed = Number(value as string);
                            audio.bitrate = Number.isNaN(parsed) ? undefined : parsed;
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

                    <div class="space-y-2">
                      <Label class="block text-xs">
                        {{ t("presetEditor.audio.loudnessProfileLabel", "响度均衡策略") }}
                      </Label>
                      <div class="grid grid-cols-3 gap-2">
                        <Button
                          :variant="!audio.loudnessProfile || audio.loudnessProfile === 'none' ? 'default' : 'outline'"
                          class="h-8 px-2 text-[11px]"
                          @click="audio.loudnessProfile = 'none'"
                        >
                          {{ t("presetEditor.audio.loudnessNone", "不过滤（保持源响度）") }}
                        </Button>
                        <Button
                          :variant="audio.loudnessProfile === 'cnBroadcast' ? 'default' : 'outline'"
                          class="h-8 px-2 text-[11px]"
                          @click="audio.loudnessProfile = 'cnBroadcast'"
                        >
                          {{ t("presetEditor.audio.loudnessCnBroadcast", "国内广电响度") }}
                        </Button>
                        <Button
                          :variant="audio.loudnessProfile === 'ebuR128' ? 'default' : 'outline'"
                          class="h-8 px-2 text-[11px]"
                          @click="audio.loudnessProfile = 'ebuR128'"
                        >
                          {{ t("presetEditor.audio.loudnessEbuR128", "EBU/国际响度") }}
                        </Button>
                      </div>
                      <p class="mt-1 text-[11px] text-muted-foreground">
                        {{
                          t(
                            "presetEditor.audio.loudnessHelp",
                            "推荐使用响度均衡：国内广电约 I=-24 LUFS，国际规范约 I=-23 LUFS，动态范围通常 1–10 LU，真峰值建议控制在 -2/-1 dBTP 附近；数值越接近 0 主观越响，长片节目一般不建议高于约 -16 LUFS。",
                          )
                        }}
                      </p>
                    </div>

                    <div class="grid grid-cols-3 gap-3">
                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.sampleRateLabel", "采样率 (Hz)") }}
                        </Label>
                        <Select
                          :model-value="audio.sampleRateHz ? String(audio.sampleRateHz) : ''"
                          @update:model-value="
                            (value) => {
                              const parsed = Number(value as string);
                              audio.sampleRateHz = Number.isNaN(parsed) ? undefined : parsed;
                            }
                          "
                        >
                          <SelectTrigger class="h-8 text-xs">
                            <SelectValue
                              :placeholder="t('presetEditor.audio.sampleRatePlaceholder', '保持原样')"
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="44100">44100</SelectItem>
                            <SelectItem value="48000">48000</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.channelsLabel", "声道数") }}
                        </Label>
                        <Select
                          :model-value="audio.channels ? String(audio.channels) : ''"
                          @update:model-value="
                            (value) => {
                              const parsed = Number(value as string);
                              audio.channels = Number.isNaN(parsed) ? undefined : parsed;
                            }
                          "
                        >
                          <SelectTrigger class="h-8 text-xs">
                            <SelectValue
                              :placeholder="t('presetEditor.audio.channelsPlaceholder', '保持原样')"
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="6">6</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.layoutLabel", "声道布局") }}
                        </Label>
                        <Input
                          :model-value="audio.channelLayout ?? ''"
                          :placeholder="t('presetEditor.audio.layoutPlaceholder', '例如 stereo, 5.1')"
                          class="h-8 text-xs"
                          @update:model-value="
                            (value) => {
                              const v = String(value ?? '');
                              audio.channelLayout = v || undefined;
                            }
                          "
                        />
                      </div>
                    </div>

                    <div class="grid grid-cols-3 gap-3">
                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.targetLufsLabel", "目标响度 (LUFS)") }}
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          class="h-8 text-xs"
                          :model-value="audio.targetLufs != null ? String(audio.targetLufs) : ''"
                          :placeholder="audio.loudnessProfile === 'cnBroadcast' ? '-24' : audio.loudnessProfile === 'ebuR128' ? '-23' : ''"
                          @update:model-value="
                            (value) => {
                              const n = Number(value ?? '');
                              audio.targetLufs = Number.isFinite(n) ? n : undefined;
                            }
                          "
                        />
                      </div>

                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.loudnessRangeLabel", "动态范围 (LRA)") }}
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          class="h-8 text-xs"
                          :model-value="audio.loudnessRange != null ? String(audio.loudnessRange) : ''"
                          :placeholder="'7'"
                          @update:model-value="
                            (value) => {
                              const n = Number(value ?? '');
                              audio.loudnessRange = Number.isFinite(n) ? n : undefined;
                            }
                          "
                        />
                      </div>

                      <div class="space-y-1">
                        <Label class="block text-xs">
                          {{ t("presetEditor.audio.truePeakDbLabel", "真峰值上限 (dBTP)") }}
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          class="h-8 text-xs"
                          :model-value="audio.truePeakDb != null ? String(audio.truePeakDb) : ''"
                          :placeholder="audio.loudnessProfile === 'cnBroadcast' ? '-2' : audio.loudnessProfile === 'ebuR128' ? '-1' : ''"
                          @update:model-value="
                            (value) => {
                              const n = Number(value ?? '');
                              audio.truePeakDb = Number.isFinite(n) ? n : undefined;
                            }
                          "
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="bg-muted/40 p-4 rounded-md border border-border/60">
                <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
                  {{ t("presetEditor.panel.subtitlesTitle", "字幕策略") }}
                </h3>
                <div class="space-y-3">
                  <div class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.subtitlesStrategyLabel", "处理方式") }}
                    </Label>
                    <Select
                      :model-value="subtitles.strategy ?? 'keep'"
                      @update:model-value="(value) => { subtitles.strategy = value as any; }"
                    >
                      <SelectTrigger class="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep">
                          {{ t("presetEditor.panel.subtitlesKeep", "保留（默认）") }}
                        </SelectItem>
                        <SelectItem value="drop">
                          {{ t("presetEditor.panel.subtitlesDrop", "移除所有字幕 (-sn)") }}
                        </SelectItem>
                        <SelectItem value="burn_in">
                          {{ t("presetEditor.panel.subtitlesBurnIn", "烧录到画面（滤镜）") }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div v-if="subtitles.strategy === 'burn_in'" class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.subtitlesBurnInFilterLabel", "烧录滤镜表达式") }}
                    </Label>
                    <Input
                      :model-value="subtitles.burnInFilter ?? ''"
                      :placeholder="
                        t(
                          'presetEditor.panel.subtitlesBurnInFilterPlaceholder',
                          '例如 subtitles=INPUT:si=0',
                        )
                      "
                      class="h-8 text-xs font-mono"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          subtitles.burnInFilter = v || undefined;
                        }
                      "
                    />
                    <p class="text-[11px] text-muted-foreground">
                      {{
                        t(
                          "presetEditor.panel.subtitlesBurnInHelp",
                          "此字段会追加到视频滤镜链中；复杂多轨场景建议仍使用模板模式。",
                        )
                      }}
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

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label class="block text-xs mb-1">
                        {{ t("presetEditor.filters.cropLabel", "裁剪 (crop)") }}
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
                        {{ t("presetEditor.filters.fpsLabel", "输出帧率 (fps)") }}
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
                      {{ t("presetEditor.filters.vfChainLabel", "附加视频滤镜链 (-vf)") }}
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
                      {{ t("presetEditor.filters.afChainLabel", "附加音频滤镜链 (-af)") }}
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
                      {{ t("presetEditor.filters.filterComplexLabel", "复杂滤镜图 (-filter_complex)") }}
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
            </TabsContent>

            <TabsContent
              value="container"
              class="mt-0 space-y-4"
            >
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
            </TabsContent>

            <TabsContent
              value="hardware"
              class="mt-0 space-y-4"
            >
              <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
                <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
                  {{ t("presetEditor.panel.hardwareTitle", "硬件加速与比特流过滤") }}
                </h3>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.hwaccelLabel", "硬件解码 (-hwaccel)") }}
                    </Label>
                    <Select
                      :model-value="hardware.hwaccel ?? ''"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          hardware.hwaccel = v || undefined;
                        }
                      "
                    >
                      <SelectTrigger class="h-8 text-xs">
                        <SelectValue
                          :placeholder="t('presetEditor.panel.hwaccelPlaceholder', '自动选择或禁用')"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cuda">cuda</SelectItem>
                        <SelectItem value="qsv">qsv</SelectItem>
                        <SelectItem value="vaapi">vaapi</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.hwaccelDeviceLabel", "设备 (-hwaccel_device)") }}
                    </Label>
                    <Input
                      :model-value="hardware.hwaccelDevice ?? ''"
                      :placeholder="t('presetEditor.panel.hwaccelDevicePlaceholder', '例如 cuda:0')"
                      class="h-8 text-xs"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          hardware.hwaccelDevice = v || undefined;
                        }
                      "
                    />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.hwaccelOutputFormatLabel", "输出像素格式 (-hwaccel_output_format)") }}
                    </Label>
                    <Input
                      :model-value="hardware.hwaccelOutputFormat ?? ''"
                      :placeholder="t('presetEditor.panel.hwaccelOutputFormatPlaceholder', '例如 cuda 或 nv12')"
                      class="h-8 text-xs"
                      @update:model-value="
                        (value) => {
                          const v = String(value ?? '');
                          hardware.hwaccelOutputFormat = v || undefined;
                        }
                      "
                    />
                  </div>

                  <div class="space-y-1">
                    <Label class="text-xs">
                      {{ t("presetEditor.panel.bitstreamFiltersLabel", "比特流过滤器 (-bsf，逐行)") }}
                    </Label>
                    <Textarea
                      :model-value="(hardware.bitstreamFilters ?? []).join('\n')"
                      :placeholder="
                        t(
                          'presetEditor.panel.bitstreamFiltersPlaceholder',
                          '例如 h264_mp4toannexb\\naac_adtstoasc',
                        )
                      "
                      class="min-h-[72px] text-[11px] font-mono"
                      @update:model-value="
                        (value) => {
                          const text = String(value ?? '');
                          const filters = text
                            .split('\n')
                            .map((v) => v.trim())
                            .filter((v) => v.length > 0);
                          hardware.bitstreamFilters = filters.length > 0 ? filters : undefined;
                        }
                      "
                    />
                  </div>
                </div>

                <p class="text-[11px] text-muted-foreground">
                  {{
                    t(
                      "presetEditor.panel.hardwareHelp",
                      "通常仅在需要配合特定 GPU/协议或封装器时才需要调整这些选项；如无把握建议保持默认，仅通过编码器选择使用硬件加速。",
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
              class="flex-1 rounded-md bg-background/90 border border-border/60 px-2 py-2 text-[12px] md:text-[13px] font-mono text-muted-foreground overflow-y-auto whitespace-pre-wrap break-all select-text"
              :data-active-group="activeTab"
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
              <Label class="inline-flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                <Checkbox v-model:checked="advancedEnabled" />
                <span>{{ t("presetEditor.advanced.enabledLabel") }}</span>
              </Label>
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
