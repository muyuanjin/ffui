<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FFmpegPreset, BatchCompressConfig } from "../types";
import { VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, AUDIO_EXTENSIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import { buildBatchCompressConfig } from "@/lib/batchCompressConfig";
import BatchCompressSavingConditionSection from "@/components/batch-compress/BatchCompressSavingConditionSection.vue";
const props = defineProps<{
  presets: FFmpegPreset[];
  initialConfig?: BatchCompressConfig;
  /** 主界面默认视频预设，用于同步默认选择 */
  defaultVideoPresetId?: string | null;
}>();

const emit = defineEmits<{
  (e: "run", value: BatchCompressConfig): void;
  (e: "cancel"): void;
}>();
const { t } = useI18n();
// 深拷贝初始配置
const config = ref<BatchCompressConfig>(
  buildBatchCompressConfig({
    presets: props.presets,
    initialConfig: props.initialConfig,
    defaultVideoPresetId: props.defaultVideoPresetId,
  }),
);

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

const setExtensionSelected = (
  filterKey: "videoFilter" | "imageFilter" | "audioFilter",
  ext: string,
  selected: boolean,
) => {
  const filter = config.value[filterKey];
  const idx = filter.extensions.indexOf(ext);
  if (selected && idx === -1) {
    filter.extensions.push(ext);
    return;
  }
  if (!selected && idx >= 0) {
    filter.extensions.splice(idx, 1);
  }
};

// 全选/取消全选扩展名
const selectAllExtensions = (filterKey: "videoFilter" | "imageFilter" | "audioFilter", allExts: string[]) => {
  config.value[filterKey].extensions = [...allExts];
};

const deselectAllExtensions = (filterKey: "videoFilter" | "imageFilter" | "audioFilter") => {
  config.value[filterKey].extensions = [];
};

// 计算是否可以开始扫描
const canStart = computed(() => {
  const hasPath = !!config.value.rootPath?.trim();
  const hasAnyFilter =
    config.value.videoFilter.enabled || config.value.imageFilter.enabled || config.value.audioFilter.enabled;
  return hasPath && hasAnyFilter;
});

const handleRun = () => {
  emit("run", config.value);
};
</script>

<template>
  <div
    class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
    @click.self="emit('cancel')"
  >
    <div class="bg-background w-full max-w-4xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]">
      <div class="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/60 rounded-t-xl shrink-0">
        <div>
          <h2 class="text-xl font-bold text-foreground flex items-center gap-2">
            <span class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg text-sm">▶</span>
            {{ t("batchCompress.title") }}
          </h2>
          <p class="text-muted-foreground text-xs mt-1">{{ t("batchCompress.subtitle") }}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground hover:text-foreground h-8 w-8"
          @click="emit('cancel')"
          >✕</Button
        >
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div
          class="bg-primary/10 border border-primary/40 p-3 rounded-lg text-xs text-foreground flex items-start gap-2"
        >
          <span class="text-primary shrink-0">!</span>
          <p>{{ t("batchCompress.notice") }}</p>
        </div>

        <div class="space-y-2">
          <Label class="text-xs font-medium text-foreground">{{ t("batchCompress.rootPath") }}</Label>
          <div class="flex gap-2">
            <Input
              v-model="config.rootPath"
              :placeholder="t('batchCompress.rootPathPlaceholder') as string"
              class="flex-1 h-9 text-sm"
            />
            <Button variant="outline" size="sm" class="h-9 px-3 shrink-0" @click="selectFolder">
              {{ t("batchCompress.browse") }}
            </Button>
          </div>
        </div>
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label class="text-xs font-medium text-foreground">{{ t("app.outputSettings") }}</Label>
            <div class="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                :variant="config.replaceOriginal ? 'default' : 'outline'"
                class="h-7 px-2 text-[10px]"
                @click="config.replaceOriginal = true"
              >
                {{ t("batchCompress.replaceOriginal") }}
              </Button>
              <Button
                type="button"
                size="xs"
                :variant="!config.replaceOriginal ? 'default' : 'outline'"
                class="h-7 px-2 text-[10px]"
                @click="config.replaceOriginal = false"
              >
                {{ t("batchCompress.keepOriginalsBatchTranscode") }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            {{
              config.replaceOriginal
                ? t("batchCompress.replaceOriginalOutputPolicyHint")
                : t("batchCompress.keepOriginalsBatchTranscodeHint")
            }}
          </p>
          <div class="bg-card/40 border border-border/60 rounded-lg p-3">
            <OutputPolicyEditor
              v-model="config.outputPolicy"
              :lock-location-and-name="config.replaceOriginal"
              :preview-preset-id="config.videoPresetId"
            />
          </div>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-emerald-400">▣</span>
                {{ t("batchCompress.videoStrategy") }}
              </h3>
              <Checkbox
                :checked="config.videoFilter.enabled"
                @update:checked="config.videoFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.videoFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.targetPreset") }}</Label>
                <Select v-model="config.videoPresetId">
                  <SelectTrigger class="h-7 text-xs">
                    <SelectValue :placeholder="t('batchCompress.targetPresetPlaceholder') as string" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.minVideoSize") }}</Label>
                <Input type="number" v-model.number="config.minVideoSizeMB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <Toggle
                    v-for="ext in VIDEO_EXTENSIONS"
                    :key="ext"
                    variant="outline"
                    size="sm"
                    :model-value="config.videoFilter.extensions.includes(ext)"
                    class="h-6 px-1.5 py-0.5 text-[10px] rounded border transition-colors data-[state=off]:border-border/50 data-[state=off]:text-muted-foreground data-[state=off]:hover:border-border data-[state=on]:bg-emerald-500/20 data-[state=on]:border-emerald-500/50 data-[state=on]:text-emerald-400"
                    @update:model-value="(on) => setExtensionSelected('videoFilter', ext, Boolean(on))"
                  >
                    .{{ ext }}
                  </Toggle>
                </div>
                <div class="flex gap-1 mt-1">
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="selectAllExtensions('videoFilter', VIDEO_EXTENSIONS)"
                  >
                    {{ t("batchCompress.selectAll") }}
                  </Button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="deselectAllExtensions('videoFilter')"
                  >
                    {{ t("batchCompress.deselectAll") }}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-purple-400">▣</span>
                {{ t("batchCompress.imageStrategy") }}
              </h3>
              <Checkbox
                :checked="config.imageFilter.enabled"
                @update:checked="config.imageFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.imageFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.targetFormat") }}</Label>
                <div class="flex gap-1">
                  <Button
                    :variant="config.imageTargetFormat === 'avif' ? 'default' : 'outline'"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    @click="config.imageTargetFormat = 'avif'"
                    >AVIF</Button
                  >
                  <Button
                    :variant="config.imageTargetFormat === 'webp' ? 'default' : 'outline'"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    @click="config.imageTargetFormat = 'webp'"
                    >WebP</Button
                  >
                </div>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.minImageSize") }}</Label>
                <Input type="number" v-model.number="config.minImageSizeKB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <Toggle
                    v-for="ext in IMAGE_EXTENSIONS"
                    :key="ext"
                    variant="outline"
                    size="sm"
                    :model-value="config.imageFilter.extensions.includes(ext)"
                    class="h-6 px-1.5 py-0.5 text-[10px] rounded border transition-colors data-[state=off]:border-border/50 data-[state=off]:text-muted-foreground data-[state=off]:hover:border-border data-[state=on]:bg-purple-500/20 data-[state=on]:border-purple-500/50 data-[state=on]:text-purple-400"
                    @update:model-value="(on) => setExtensionSelected('imageFilter', ext, Boolean(on))"
                  >
                    .{{ ext }}
                  </Toggle>
                </div>
                <div class="flex gap-1 mt-1">
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="selectAllExtensions('imageFilter', IMAGE_EXTENSIONS)"
                  >
                    {{ t("batchCompress.selectAll") }}
                  </Button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="deselectAllExtensions('imageFilter')"
                  >
                    {{ t("batchCompress.deselectAll") }}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3 p-3 rounded-lg border border-border/60 bg-muted/30">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold flex items-center gap-2">
                <span class="text-amber-400">▣</span>
                {{ t("batchCompress.audioStrategy") }}
              </h3>
              <Checkbox
                :checked="config.audioFilter.enabled"
                @update:checked="config.audioFilter.enabled = Boolean($event)"
              />
            </div>

            <div v-if="config.audioFilter.enabled" class="space-y-3">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.audioPreset") }}</Label>
                <Select v-model="audioPresetSelectValue">
                  <SelectTrigger class="h-7 text-xs">
                    <SelectValue :placeholder="t('batchCompress.audioPresetPlaceholder') as string" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="AUDIO_PRESET_DEFAULT_VALUE">
                      {{ t("batchCompress.audioDefaultCompress") }}
                    </SelectItem>
                    <SelectItem v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.minAudioSize") }}</Label>
                <Input type="number" v-model.number="config.minAudioSizeKB" class="h-7 text-xs" />
              </div>

              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("batchCompress.fileTypes") }}</Label>
                <div class="flex flex-wrap gap-1">
                  <Toggle
                    v-for="ext in AUDIO_EXTENSIONS"
                    :key="ext"
                    variant="outline"
                    size="sm"
                    :model-value="config.audioFilter.extensions.includes(ext)"
                    class="h-6 px-1.5 py-0.5 text-[10px] rounded border transition-colors data-[state=off]:border-border/50 data-[state=off]:text-muted-foreground data-[state=off]:hover:border-border data-[state=on]:bg-amber-500/20 data-[state=on]:border-amber-500/50 data-[state=on]:text-amber-400"
                    @update:model-value="(on) => setExtensionSelected('audioFilter', ext, Boolean(on))"
                  >
                    .{{ ext }}
                  </Toggle>
                </div>
                <div class="flex gap-1 mt-1">
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="selectAllExtensions('audioFilter', AUDIO_EXTENSIONS)"
                  >
                    {{ t("batchCompress.selectAll") }}
                  </Button>
                  <span class="text-[9px] text-muted-foreground">/</span>
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto p-0 text-[9px]"
                    @click="deselectAllExtensions('audioFilter')"
                  >
                    {{ t("batchCompress.deselectAll") }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <BatchCompressSavingConditionSection
          :saving-condition-type="config.savingConditionType"
          :min-saving-ratio="config.minSavingRatio"
          :min-saving-absolute-mb="config.minSavingAbsoluteMB"
          @update:saving-condition-type="config.savingConditionType = $event"
          @update:min-saving-ratio="config.minSavingRatio = $event"
          @update:min-saving-absolute-mb="config.minSavingAbsoluteMB = $event"
        />
      </div>

      <!-- 底部按钮 -->
      <div class="px-6 py-4 border-t border-border bg-muted/60 rounded-b-xl flex justify-between items-center shrink-0">
        <p class="text-xs text-muted-foreground">
          {{ config.rootPath ? config.rootPath : t("batchCompress.noPathSelected") }}
        </p>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" class="h-9" @click="emit('cancel')">
            {{ t("common.cancel") }}
          </Button>
          <Button size="sm" class="h-9 px-6 font-bold flex items-center gap-2" :disabled="!canStart" @click="handleRun">
            ▶ {{ t("batchCompress.scanButton") }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
