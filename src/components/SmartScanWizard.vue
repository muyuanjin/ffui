<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FFmpegPreset, SmartScanConfig } from "../types";
import {
  DEFAULT_SMART_SCAN_CONFIG,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

const props = defineProps<{
  presets: FFmpegPreset[];
  initialConfig?: SmartScanConfig;
  /** 主界面默认视频预设，用于同步默认选择 */
  defaultVideoPresetId?: string | null;
}>();

const emit = defineEmits<{
  (e: "run", value: SmartScanConfig): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

// 深拷贝初始配置
const config = ref<SmartScanConfig>({
  ...DEFAULT_SMART_SCAN_CONFIG,
  ...props.initialConfig,
  videoPresetId:
    props.initialConfig?.videoPresetId ||
    props.defaultVideoPresetId ||
    props.presets[0]?.id ||
    "",
  videoFilter: {
    enabled: props.initialConfig?.videoFilter?.enabled ?? true,
    extensions: [...(props.initialConfig?.videoFilter?.extensions ?? VIDEO_EXTENSIONS)],
  },
  imageFilter: {
    enabled: props.initialConfig?.imageFilter?.enabled ?? true,
    extensions: [...(props.initialConfig?.imageFilter?.extensions ?? IMAGE_EXTENSIONS)],
  },
  audioFilter: {
    enabled: props.initialConfig?.audioFilter?.enabled ?? false,
    extensions: [...(props.initialConfig?.audioFilter?.extensions ?? AUDIO_EXTENSIONS)],
  },
});

// 为了兼容 reka-ui Select 的约束（选项 value 不能为 ""），在音频预设选择上使用哨兵值
const AUDIO_PRESET_DEFAULT_VALUE = "__ffui__audio_default__";

const audioPresetSelectValue = computed<string>({
  get() {
    const id = config.value.audioPresetId;
    return id && id.length > 0 ? id : AUDIO_PRESET_DEFAULT_VALUE;
  },
  set(value: string) {
    if (value === AUDIO_PRESET_DEFAULT_VALUE) {
      // 保持对外语义不变：空字符串/未定义表示使用默认音频压缩
      config.value.audioPresetId = "";
    } else {
      config.value.audioPresetId = value;
    }
  },
});

// 监听 initialConfig 变化
watch(
  () => props.initialConfig,
  (newConfig) => {
    if (newConfig?.rootPath) {
      config.value.rootPath = newConfig.rootPath;
    }
  },
  { immediate: true },
);

// 当默认预设或预设列表变化时，若当前选择无效则回落到主界面默认预设
watch(
  () => [props.defaultVideoPresetId, props.presets.map((p) => p.id).join(",")],
  () => {
    const hasValidSelection =
      !!config.value.videoPresetId && props.presets.some((p) => p.id === config.value.videoPresetId);
    if (hasValidSelection) return;
    config.value.videoPresetId = props.defaultVideoPresetId || props.presets[0]?.id || "";
  },
);

// 监听媒体类型启用状态，启用时自动勾选所有对应的文件类型
watch(
  () => config.value.videoFilter.enabled,
  (enabled) => {
    if (enabled) {
      config.value.videoFilter.extensions = [...VIDEO_EXTENSIONS];
    }
  },
);

watch(
  () => config.value.imageFilter.enabled,
  (enabled) => {
    if (enabled) {
      config.value.imageFilter.extensions = [...IMAGE_EXTENSIONS];
    }
  },
);

watch(
  () => config.value.audioFilter.enabled,
  (enabled) => {
    if (enabled) {
      config.value.audioFilter.extensions = [...AUDIO_EXTENSIONS];
    }
  },
);

// 选择文件夹
const selectFolder = async () => {
  if (!hasTauri()) return;
  try {
    const selected = await openDialog({
      multiple: false,
      directory: true,
    });
    if (selected && typeof selected === "string") {
      config.value.rootPath = selected;
    } else if (Array.isArray(selected) && selected[0]) {
      config.value.rootPath = selected[0];
    }
  } catch (err) {
    console.error("Failed to open directory dialog:", err);
  }
};

// 切换扩展名选择
const toggleExtension = (
  filterKey: "videoFilter" | "imageFilter" | "audioFilter",
  ext: string,
) => {
  const filter = config.value[filterKey];
  const idx = filter.extensions.indexOf(ext);
  if (idx >= 0) {
    filter.extensions.splice(idx, 1);
  } else {
    filter.extensions.push(ext);
  }
};

// 全选/取消全选扩展名
const selectAllExtensions = (
  filterKey: "videoFilter" | "imageFilter" | "audioFilter",
  allExts: string[],
) => {
  config.value[filterKey].extensions = [...allExts];
};

const deselectAllExtensions = (
  filterKey: "videoFilter" | "imageFilter" | "audioFilter",
) => {
  config.value[filterKey].extensions = [];
};

// 计算是否可以开始扫描
const canStart = computed(() => {
  const hasPath = !!config.value.rootPath?.trim();
  const hasAnyFilter =
    config.value.videoFilter.enabled ||
    config.value.imageFilter.enabled ||
    config.value.audioFilter.enabled;
  return hasPath && hasAnyFilter;
});

const handleRun = () => {
  emit("run", config.value);
};
</script>

<template>
  <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
    <div class="bg-background w-full max-w-4xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]">
      <!-- 标题栏 -->
      <div class="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/60 rounded-t-xl shrink-0">
        <div>
          <h2 class="text-xl font-bold text-foreground flex items-center gap-2">
            <span class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg text-sm">▶</span>
            {{ t("smartScan.title") }}
          </h2>
          <p class="text-muted-foreground text-xs mt-1">{{ t("smartScan.subtitle") }}</p>
        </div>
        <Button variant="ghost" size="icon" class="text-muted-foreground hover:text-foreground h-8 w-8" @click="emit('cancel')">✕</Button>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <!-- 提示信息 -->
        <div class="bg-primary/10 border border-primary/40 p-3 rounded-lg text-xs text-foreground flex items-start gap-2">
          <span class="text-primary shrink-0">!</span>
          <p>{{ t("smartScan.notice") }}</p>
        </div>

        <!-- 路径选择 -->
        <div class="space-y-2">
          <Label class="text-xs font-medium text-foreground">{{ t("smartScan.rootPath") }}</Label>
          <div class="flex gap-2">
            <Input
              v-model="config.rootPath"
              :placeholder="t('smartScan.rootPathPlaceholder') as string"
              class="flex-1 h-9 text-sm"
            />
            <Button variant="outline" size="sm" class="h-9 px-3 shrink-0" @click="selectFolder">
              {{ t("smartScan.browse") }}
            </Button>
          </div>
        </div>

        <!-- 基本选项 -->
        <div class="flex items-center gap-6 py-2 border-y border-border/50">
          <label class="flex items-center gap-2 cursor-pointer">
            <Checkbox
              :checked="config.replaceOriginal"
              @update:checked="config.replaceOriginal = Boolean($event)"
            />
            <span class="text-sm">{{ t("smartScan.replaceOriginal") }}</span>
          </label>
          <p class="text-xs text-muted-foreground">{{ t("smartScan.replaceOriginalHint") }}</p>
        </div>

        <!-- 三列布局：视频、图片、音频 -->
        <div class="grid grid-cols-3 gap-4">
          <!-- 视频策略 -->
          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-emerald-400">▣</span>
                {{ t("smartScan.videoStrategy") }}
              </h3>
              <Checkbox
                :checked="config.videoFilter.enabled"
                @update:checked="config.videoFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.videoFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.targetPreset") }}</Label>
                <Select v-model="config.videoPresetId">
                  <SelectTrigger class="h-7 text-xs">
                    <SelectValue :placeholder="t('smartScan.targetPresetPlaceholder') as string" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.minVideoSize") }}</Label>
                <Input type="number" v-model.number="config.minVideoSizeMB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="ext in VIDEO_EXTENSIONS"
                    :key="ext"
                    class="px-1.5 py-0.5 text-[10px] rounded border transition-colors"
                    :class="config.videoFilter.extensions.includes(ext) ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-border/50 text-muted-foreground hover:border-border'"
                    @click="toggleExtension('videoFilter', ext)"
                  >
                    .{{ ext }}
                  </button>
                </div>
                <div class="flex gap-1 mt-1">
                  <button class="text-[9px] text-primary hover:underline" @click="selectAllExtensions('videoFilter', VIDEO_EXTENSIONS)">{{ t("smartScan.selectAll") }}</button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <button class="text-[9px] text-primary hover:underline" @click="deselectAllExtensions('videoFilter')">{{ t("smartScan.deselectAll") }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 图片策略 -->
          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-purple-400">▣</span>
                {{ t("smartScan.imageStrategy") }}
              </h3>
              <Checkbox
                :checked="config.imageFilter.enabled"
                @update:checked="config.imageFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.imageFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.targetFormat") }}</Label>
                <div class="flex gap-1">
                  <Button
                    :variant="config.imageTargetFormat === 'avif' ? 'default' : 'outline'"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    @click="config.imageTargetFormat = 'avif'"
                  >AVIF</Button>
                  <Button
                    :variant="config.imageTargetFormat === 'webp' ? 'default' : 'outline'"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    @click="config.imageTargetFormat = 'webp'"
                  >WebP</Button>
                </div>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.minImageSize") }}</Label>
                <Input type="number" v-model.number="config.minImageSizeKB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="ext in IMAGE_EXTENSIONS"
                    :key="ext"
                    class="px-1.5 py-0.5 text-[10px] rounded border transition-colors"
                    :class="config.imageFilter.extensions.includes(ext) ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' : 'border-border/50 text-muted-foreground hover:border-border'"
                    @click="toggleExtension('imageFilter', ext)"
                  >
                    .{{ ext }}
                  </button>
                </div>
                <div class="flex gap-1 mt-1">
                  <button class="text-[9px] text-primary hover:underline" @click="selectAllExtensions('imageFilter', IMAGE_EXTENSIONS)">{{ t("smartScan.selectAll") }}</button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <button class="text-[9px] text-primary hover:underline" @click="deselectAllExtensions('imageFilter')">{{ t("smartScan.deselectAll") }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 音频策略 -->
          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-amber-400">▣</span>
                {{ t("smartScan.audioStrategy") }}
              </h3>
              <Checkbox
                :checked="config.audioFilter.enabled"
                @update:checked="config.audioFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.audioFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.audioPreset") }}</Label>
                <Select v-model="audioPresetSelectValue">
                  <SelectTrigger class="h-7 text-xs">
                    <SelectValue :placeholder="t('smartScan.audioPresetPlaceholder') as string" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="AUDIO_PRESET_DEFAULT_VALUE">
                      {{ t("smartScan.audioDefaultCompress") }}
                    </SelectItem>
                    <SelectItem v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.minAudioSize") }}</Label>
                <Input type="number" v-model.number="config.minAudioSizeKB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="ext in AUDIO_EXTENSIONS"
                    :key="ext"
                    class="px-1.5 py-0.5 text-[10px] rounded border transition-colors"
                    :class="config.audioFilter.extensions.includes(ext) ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'border-border/50 text-muted-foreground hover:border-border'"
                    @click="toggleExtension('audioFilter', ext)"
                  >
                    .{{ ext }}
                  </button>
                </div>
                <div class="flex gap-1 mt-1">
                  <button class="text-[9px] text-primary hover:underline" @click="selectAllExtensions('audioFilter', AUDIO_EXTENSIONS)">{{ t("smartScan.selectAll") }}</button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <button class="text-[9px] text-primary hover:underline" @click="deselectAllExtensions('audioFilter')">{{ t("smartScan.deselectAll") }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 保留条件 -->
        <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
          <h3 class="text-sm font-bold flex items-center gap-2">
            <span class="text-blue-400">▣</span>
            {{ t("smartScan.savingCondition") }}
          </h3>

          <div class="flex gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="savingCondition"
                value="ratio"
                :checked="config.savingConditionType === 'ratio'"
                class="accent-primary"
                @change="config.savingConditionType = 'ratio'"
              />
              <span class="text-xs">{{ t("smartScan.savingByRatio") }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="savingCondition"
                value="absoluteSize"
                :checked="config.savingConditionType === 'absoluteSize'"
                class="accent-primary"
                @change="config.savingConditionType = 'absoluteSize'"
              />
              <span class="text-xs">{{ t("smartScan.savingByAbsolute") }}</span>
            </label>
          </div>

          <!-- 按压缩率 -->
          <div v-if="config.savingConditionType === 'ratio'" class="space-y-2">
            <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.minSavingRatioLabel") }}</Label>
            <div class="flex items-center gap-4">
              <Slider
                :min="0.5"
                :max="0.99"
                :step="0.01"
                :model-value="[config.minSavingRatio]"
                class="flex-1"
                @update:model-value="(v) => { config.minSavingRatio = (v as number[])[0]; }"
              />
              <span class="text-emerald-400 font-mono font-bold w-12 text-right text-sm">
                {{ (config.minSavingRatio * 100).toFixed(0) }}%
              </span>
            </div>
            <p class="text-[10px] text-muted-foreground">
              {{ t("smartScan.minSavingRatioHelp", { ratio: (config.minSavingRatio * 100).toFixed(0) }) }}
            </p>
          </div>

          <!-- 按绝对大小 -->
          <div v-else class="space-y-2">
            <Label class="text-[10px] text-muted-foreground">{{ t("smartScan.minSavingAbsoluteLabel") }}</Label>
            <div class="flex items-center gap-2">
              <Input type="number" v-model.number="config.minSavingAbsoluteMB" class="w-24 h-8 text-sm" />
              <span class="text-xs text-muted-foreground">MB</span>
            </div>
            <p class="text-[10px] text-muted-foreground">
              {{ t("smartScan.minSavingAbsoluteHelp", { size: config.minSavingAbsoluteMB }) }}
            </p>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="px-6 py-4 border-t border-border bg-muted/60 rounded-b-xl flex justify-between items-center shrink-0">
        <p class="text-xs text-muted-foreground">
          {{ config.rootPath ? config.rootPath : t("smartScan.noPathSelected") }}
        </p>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" class="h-9" @click="emit('cancel')">
            {{ t("common.cancel") }}
          </Button>
          <Button
            size="sm"
            class="h-9 px-6 font-bold flex items-center gap-2"
            :disabled="!canStart"
            @click="handleRun"
          >
            ▶ {{ t("smartScan.scanButton") }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
