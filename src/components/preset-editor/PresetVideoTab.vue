<script setup lang="ts">
import { computed } from "vue";
import type { DeepWritable, VideoConfig } from "@/types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "@/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  video: VideoConfig;
  isCopyEncoder: boolean;
  rateControlLabel: string;
}>();

const video: DeepWritable<VideoConfig> = props.video;

const { t } = useI18n();

const AUTO_VALUE = "__auto__";

const isNvencEncoder = computed(
  () => typeof video.encoder === "string" && video.encoder.toLowerCase().includes("nvenc"),
);

const isX264Encoder = computed(() => video.encoder === "libx264");

const rateControlModeLabel = computed(() => {
  const raw = String(video.rateControl ?? "").trim();
  return raw ? raw.toUpperCase() : "";
});

const passModeLabel = computed(() => {
  const raw = video.pass ? String(video.pass) : "single";
  const map: Record<string, string> = {
    single: t("presetEditor.video.passSingle"),
    "1": t("presetEditor.video.passFirst"),
    "2": t("presetEditor.video.passSecond"),
  };
  return map[raw] ?? raw;
});

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
    <div>
      <Label class="text-xs mb-1 block">{{ t("presetEditor.video.encoder") }}</Label>
      <Select
        :model-value="video.encoder"
        @update:model-value="
          (value) => {
            const next = value as VideoConfig['encoder'];
            video.encoder = next;

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
        <SelectTrigger class="h-9">
          <SelectValue :placeholder="t('presetEditor.video.encoderPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="opt in ENCODER_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div v-if="!props.isCopyEncoder" class="space-y-3">
      <div class="bg-muted/40 p-3 rounded-md border border-border/60">
        <div class="flex justify-between items-center mb-2">
          <span class="font-medium text-sm">{{ props.rateControlLabel }}</span>
          <span class="text-primary font-bold text-xl">{{ video.qualityValue }}</span>
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
        <p class="mt-1 text-[10px] text-muted-foreground">
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

      <div class="grid grid-cols-2 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.rateControlModeLabel") }}</Label>
          <Select
            :model-value="video.rateControl"
            @update:model-value="
              (value) => {
                video.rateControl = value as VideoConfig['rateControl'];
                if (video.rateControl === 'crf' || video.rateControl === 'cq') {
                  video.bitrateKbps = undefined;
                  video.maxBitrateKbps = undefined;
                  video.bufferSizeKbits = undefined;
                  video.pass = undefined;
                }
              }
            "
          >
            <SelectTrigger class="h-9" data-testid="preset-video-rate-control-trigger">
              <SelectValue>{{ rateControlModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-if="video.encoder !== 'hevc_nvenc'" value="crf"> CRF </SelectItem>
              <SelectItem v-else value="cq"> CQ </SelectItem>
              <SelectItem value="vbr"> VBR </SelectItem>
              <SelectItem value="cbr"> CBR </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bitrateKbpsLabel") }}</Label>
          <Input
            type="number"
            min="0"
            class="h-9 text-xs"
            :model-value="video.bitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.bitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
        </div>
      </div>

      <div v-if="video.rateControl === 'vbr' || video.rateControl === 'cbr'" class="grid grid-cols-2 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.maxBitrateKbpsLabel") }}</Label>
          <Input
            type="number"
            min="0"
            class="h-9 text-xs"
            :model-value="video.maxBitrateKbps ?? ''"
            @update:model-value="
              (value) => {
                const n = Number(value ?? '');
                video.maxBitrateKbps = Number.isFinite(n) && n > 0 ? n : undefined;
              }
            "
          />
        </div>
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.passLabel") }}</Label>
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
            <SelectTrigger class="h-9" data-testid="preset-video-pass-trigger">
              <SelectValue>{{ passModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">
                {{ t("presetEditor.video.passSingle") }}
              </SelectItem>
              <SelectItem value="1">
                {{ t("presetEditor.video.passFirst") }}
              </SelectItem>
              <SelectItem value="2">
                {{ t("presetEditor.video.passSecond") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label class="text-xs mb-1 block">{{ t("presetEditor.video.presetLabel") }}</Label>
        <Select
          :model-value="video.preset"
          @update:model-value="
            (value) => {
              video.preset = value as string;
            }
          "
        >
          <SelectTrigger class="h-9" data-testid="preset-video-preset-trigger">
            <SelectValue>{{ video.preset }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in PRESET_OPTIONS[video.encoder]" :key="p" :value="p">
              {{ p }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.gopLabel") }}</Label>
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
            {{ t("presetEditor.video.gopHelp") }}
          </p>
        </div>
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bfLabel") }}</Label>
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
          <p class="text-[10px] text-muted-foreground mt-1">
            {{ t("presetEditor.video.bfHelp") }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.pixFmtLabel") }}</Label>
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
          <p class="text-[10px] text-muted-foreground mt-1">
            {{ t("presetEditor.video.pixFmtHelp") }}
          </p>
        </div>

        <div v-if="isNvencEncoder" class="space-y-1">
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.bRefModeLabel") }}</Label>
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
          <p class="text-[10px] text-muted-foreground">
            {{ t("presetEditor.video.bRefModeHelp") }}
          </p>
        </div>
      </div>

      <div v-if="isNvencEncoder" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.rcLookaheadLabel") }}</Label>
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
          <p class="text-[10px] text-muted-foreground mt-1">
            {{ t("presetEditor.video.rcLookaheadHelp") }}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.spatialAqLabel") }}</Label>
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
            <Label class="text-xs mb-1 block">{{ t("presetEditor.video.temporalAqLabel") }}</Label>
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
        <p class="text-[10px] text-muted-foreground">
          {{ t("presetEditor.video.aqHelp") }}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.tuneLabel") }}</Label>
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
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.profileLabel") }}</Label>
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
          <Label class="text-xs mb-1 block">{{ t("presetEditor.video.levelLabel") }}</Label>
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
  </div>
</template>
