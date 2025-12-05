<script setup lang="ts">
import type { InputTimelineConfig } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  inputTimeline: InputTimelineConfig;
}>();

const inputTimeline = props.inputTimeline as any;

const { t } = useI18n();
</script>

<template>
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
</template>

