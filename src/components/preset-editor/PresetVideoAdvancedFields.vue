<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, VideoConfig } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  video: VideoConfig;
}>();

// We intentionally treat the config object as mutable state, like the main tab.
const video: DeepWritable<VideoConfig> = props.video;

const { t } = useI18n();

const AUTO_VALUE = "__auto__";

const isNvencEncoder = computed(
  () => typeof video.encoder === "string" && String(video.encoder).toLowerCase().includes("nvenc"),
);
const isX264Encoder = computed(() => video.encoder === "libx264");

const aqModeLabel = (value: "auto" | "on") => {
  return value === "on" ? t("presetEditor.video.enableOption") : t("presetEditor.video.autoOption");
};

const spatialAqModeLabel = computed(() => aqModeLabel(video.spatialAq === true ? "on" : "auto"));
const temporalAqModeLabel = computed(() => aqModeLabel(video.temporalAq === true ? "on" : "auto"));

const bRefModeLabel = computed(() => {
  return video.bRefMode ? String(video.bRefMode) : t("presetEditor.video.autoOption");
});

const tuneLabel = computed(() => {
  return video.tune ? String(video.tune) : t("presetEditor.video.autoOption");
});
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.gopLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.gopHelp')" />
        </div>
        <Input
          type="number"
          min="1"
          class="h-9 text-xs"
          :model-value="video.gopSize ?? ''"
          :placeholder="t('presetEditor.video.gopPlaceholder')"
          @update:model-value="
            (value) => {
              const n = Number(value ?? '');
              video.gopSize = Number.isFinite(n) && n > 0 ? n : undefined;
            }
          "
        />
        <p class="text-[10px] text-muted-foreground mt-1">
          {{ t("presetEditor.video.gopRangeHint") }}
        </p>
      </div>
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bfLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.bfHelp')" />
        </div>
        <Input
          type="number"
          min="0"
          class="h-9 text-xs"
          :model-value="video.bf ?? ''"
          :placeholder="t('presetEditor.video.bfPlaceholder')"
          @update:model-value="
            (value) => {
              const n = Number(value ?? '');
              video.bf = Number.isFinite(n) && n >= 0 ? n : undefined;
            }
          "
        />
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.pixFmtLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.pixFmtHelp')" />
        </div>
        <Input
          :model-value="video.pixFmt ?? ''"
          :placeholder="t('presetEditor.video.pixFmtPlaceholder')"
          class="h-9 text-xs font-mono"
          @update:model-value="
            (value) => {
              const v = String(value ?? '').trim();
              video.pixFmt = v || undefined;
            }
          "
        />
      </div>

      <div v-if="isNvencEncoder" class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bRefModeLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.bRefModeHelp')" />
        </div>
        <Select
          :model-value="video.bRefMode ?? AUTO_VALUE"
          @update:model-value="
            (value) => {
              const v = String(value ?? '').trim();
              video.bRefMode = v === AUTO_VALUE ? undefined : v;
            }
          "
        >
          <SelectTrigger class="h-9">
            <SelectValue>{{ bRefModeLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="AUTO_VALUE">
              {{ t("presetEditor.video.autoOption") }}
            </SelectItem>
            <SelectItem value="each">each</SelectItem>
            <SelectItem value="middle">middle</SelectItem>
            <SelectItem value="disabled">disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-if="isNvencEncoder" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.rcLookaheadLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.rcLookaheadHelp')" />
        </div>
        <Input
          type="number"
          min="0"
          class="h-9 text-xs"
          :model-value="video.rcLookahead ?? ''"
          :placeholder="t('presetEditor.video.rcLookaheadPlaceholder')"
          @update:model-value="
            (value) => {
              const n = Number(value ?? '');
              video.rcLookahead = Number.isFinite(n) && n >= 0 ? n : undefined;
            }
          "
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.spatialAqLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.aqHelp')" />
          </div>
          <Select
            :model-value="video.spatialAq === true ? 'on' : 'auto'"
            @update:model-value="
              (value) => {
                if (value === 'on') {
                  video.spatialAq = true;
                } else {
                  video.spatialAq = undefined;
                }
              }
            "
          >
            <SelectTrigger class="h-9">
              <SelectValue>{{ spatialAqModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{{ t("presetEditor.video.autoOption") }}</SelectItem>
              <SelectItem value="on">{{ t("presetEditor.video.enableOption") }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div class="flex items-center gap-1">
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.temporalAqLabel") }}</Label>
            <HelpTooltipIcon :text="t('presetEditor.video.aqHelp')" />
          </div>
          <Select
            :model-value="video.temporalAq === true ? 'on' : 'auto'"
            @update:model-value="
              (value) => {
                if (value === 'on') {
                  video.temporalAq = true;
                } else {
                  video.temporalAq = undefined;
                }
              }
            "
          >
            <SelectTrigger class="h-9">
              <SelectValue>{{ temporalAqModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{{ t("presetEditor.video.autoOption") }}</SelectItem>
              <SelectItem value="on">{{ t("presetEditor.video.enableOption") }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.tuneLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.tuneHelp')" />
        </div>
        <div v-if="isX264Encoder">
          <Select
            :model-value="video.tune ?? AUTO_VALUE"
            @update:model-value="
              (value) => {
                const v = String(value ?? '').trim();
                video.tune = v === AUTO_VALUE ? undefined : v;
              }
            "
          >
            <SelectTrigger class="h-9">
              <SelectValue>{{ tuneLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="AUTO_VALUE">
                {{ t("presetEditor.video.autoOption") }}
              </SelectItem>
              <SelectItem value="film">film</SelectItem>
              <SelectItem value="animation">animation</SelectItem>
              <SelectItem value="grain">grain</SelectItem>
              <SelectItem value="stillimage">stillimage</SelectItem>
              <SelectItem value="fastdecode">fastdecode</SelectItem>
              <SelectItem value="zerolatency">zerolatency</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div v-else>
          <Input
            :model-value="video.tune ?? ''"
            :placeholder="t('presetEditor.video.tunePlaceholder')"
            class="h-9 text-xs"
            @update:model-value="
              (value) => {
                const v = String(value ?? '').trim();
                video.tune = v || undefined;
              }
            "
          />
        </div>
      </div>

      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.profileLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.profileHelp')" />
        </div>
        <Input
          :model-value="video.profile ?? ''"
          :placeholder="t('presetEditor.video.profilePlaceholder')"
          class="h-9 text-xs"
          @update:model-value="
            (value) => {
              const v = String(value ?? '').trim();
              video.profile = v || undefined;
            }
          "
        />
      </div>

      <div>
        <div class="flex items-center gap-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.levelLabel") }}</Label>
          <HelpTooltipIcon :text="t('presetEditor.video.levelHelp')" />
        </div>
        <Input
          :model-value="video.level ?? ''"
          :placeholder="t('presetEditor.video.levelPlaceholder')"
          class="h-9 text-xs"
          @update:model-value="
            (value) => {
              const v = String(value ?? '').trim();
              video.level = v || undefined;
            }
          "
        />
      </div>
    </div>
  </div>
</template>
