<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ParsedMediaAnalysis, MediaFileInfo } from "@/lib/mediaInfo";
import {
  buildFormatFields,
  buildSummaryFields,
  formatFrameRate,
  mapStreamsForDisplay,
} from "@/components/panels/media/mediaPanelUtils";
import { highlightJson } from "@/lib/jsonHighlight";

const props = defineProps<{
  inspecting: boolean;
  error: string | null;
  inspectedPath: string | null;
  previewUrl: string | null;
  isImage: boolean;
  analysis: ParsedMediaAnalysis | null;
  rawJson: string | null;
}>();

const emit = defineEmits<{
  inspectRequested: [];
  clear: [];
}>();

const { t } = useI18n();

const hasMedia = computed(() => !!props.inspectedPath && !!props.analysis);

const fileInfo = computed<MediaFileInfo | null>(() => props.analysis?.file ?? null);

const fileName = computed(() => {
  const path = props.inspectedPath ?? fileInfo.value?.path ?? "";
  if (!path) return "";
  const normalised = path.replace(/\\/g, "/");
  const idx = normalised.lastIndexOf("/");
  return idx >= 0 ? normalised.slice(idx + 1) : normalised;
});

const humanType = computed(() => {
  if (!hasMedia.value) return "-";
  return props.isImage ? t("media.typeImage") : t("media.typeVideo");
});

const summaryFields = computed(() => {
  return buildSummaryFields({
    analysis: props.analysis,
    inspectedPath: props.inspectedPath,
    fileName: fileName.value,
    humanType: humanType.value as string,
    fileInfo: fileInfo.value,
    t,
  });
});

const formatFields = computed(() => {
  return buildFormatFields(props.analysis, t);
});

const streamsForDisplay = computed(() => {
  return mapStreamsForDisplay(props.analysis);
});

const hasRawJson = computed(
  () => typeof props.rawJson === "string" && props.rawJson.trim().length > 0,
);

const highlightedRawJsonHtml = computed(() => highlightJson(props.rawJson));

const copyRawJson = async () => {
  if (!hasRawJson.value || !props.rawJson) return;

  try {
    if (
      typeof navigator !== "undefined" &&
      "clipboard" in navigator &&
      (navigator as any).clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(props.rawJson);
      return;
    }

    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = props.rawJson;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  } catch (error) {
    console.error("copy raw media json failed", error);
  }
};
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-2">
      <div class="flex flex-col">
        <h3 class="text-lg font-semibold tracking-tight">
          {{ t("app.tabs.media") }}
        </h3>
        <p class="text-xs text-muted-foreground">
          {{ t("app.mediaHint") }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="!hasMedia"
          @click="emit('clear')"
        >
          {{ t("media.clearCurrent") }}
        </Button>
        <Button
          size="sm"
          :disabled="inspecting"
          @click="emit('inspectRequested')"
        >
          {{ inspecting ? t("media.inspecting") : t("media.chooseFile") }}
        </Button>
      </div>
    </div>

    <div
      v-if="error"
      class="text-xs text-destructive bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2 whitespace-pre-wrap"
    >
      {{ error }}
    </div>

    <div
      v-if="hasMedia"
      class="grid gap-4 lg:grid-cols-3"
    >
      <Card class="lg:col-span-1 flex flex-col">
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("media.sections.preview") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="flex-1 flex flex-col gap-3">
          <div class="aspect-video w-full rounded-md bg-muted/40 flex items-center justify-center overflow-hidden">
            <template v-if="previewUrl">
              <img
                v-if="isImage"
                :src="previewUrl"
                :alt="fileName || 'preview'"
                class="max-h-80 max-w-full object-contain"
                :key="previewUrl || inspectedPath || fileName"
              />
              <video
                v-else
                :src="previewUrl"
                class="max-h-80 max-w-full object-contain"
                controls
                :key="previewUrl || inspectedPath || fileName"
              />
            </template>
            <template v-else>
              <span class="text-xs text-muted-foreground">
                {{ t("taskDetail.noPreview") }}
              </span>
            </template>
          </div>
          <p class="text-[11px] text-muted-foreground break-all select-text">
            {{ fileInfo?.path || inspectedPath || "-" }}
          </p>
        </CardContent>
      </Card>

      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("media.sections.summary") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="select-text">
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div
              v-for="field in summaryFields"
              :key="field.key"
              class="flex flex-col gap-0.5"
            >
              <span
                class="text-foreground/80"
                :title="field.tooltip as string"
              >
                {{ field.label }}
              </span>
              <span class="text-muted-foreground">
                {{ field.value }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <div
      v-else
      class="border border-dashed border-border/60 rounded-lg py-10 flex flex-col items-center justify-center text-sm text-muted-foreground cursor-pointer transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      role="button"
      tabindex="0"
      @click="emit('inspectRequested')"
      @keydown.enter.stop.prevent="emit('inspectRequested')"
      @keydown.space.stop.prevent="emit('inspectRequested')"
      data-testid="media-empty-state"
    >
      <p class="text-sm font-medium mb-1">
        {{ t("media.emptyTitle") }}
      </p>
      <p class="text-xs">
        {{ t("media.emptyDescription") }}
      </p>
    </div>

    <div
      v-if="hasMedia"
      class="grid gap-4 lg:grid-cols-2"
    >
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("media.sections.format") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-xs select-text">
          <div class="grid grid-cols-2 gap-x-6 gap-y-2">
            <div
              v-for="field in formatFields.basic"
              :key="field.key"
              class="flex flex-col gap-0.5"
            >
              <span
                class="text-foreground/80"
                :title="field.tooltip as string"
              >
                {{ field.label }}
              </span>
              <span class="text-muted-foreground">
                {{ field.value }}
              </span>
            </div>
          </div>

          <div v-if="formatFields.tags.length > 0">
            <p
              class="text-foreground/80 mb-1"
              :title="t('media.fields.tags.tooltip') as string"
            >
              {{ t("media.fields.tags.label") }}
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="[key, value] in formatFields.tags"
                :key="key"
                class="px-1.5 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground"
              >
                {{ key }}={{ value }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">
            {{ t("media.sections.streams") }}
          </CardTitle>
        </CardHeader>
        <CardContent class="text-xs select-text">
          <ScrollArea class="max-h-72 pr-3">
            <div
              v-if="streamsForDisplay.length === 0"
              class="text-muted-foreground text-[11px]"
            >
              {{ t("media.noStreams") }}
            </div>
            <div
              v-for="stream in streamsForDisplay"
              :key="stream.id"
              class="mb-3 last:mb-0 pb-3 border-b border-border/50 last:border-b-0"
            >
              <p class="font-medium text-foreground mb-1">
                #{{ stream.id }} · {{ stream.type }}
              </p>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamCodec.tooltip') as string"
                  >
                    {{ t("media.fields.streamCodec.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    {{ stream.raw.codecName || "-" }}
                    <span
                      v-if="stream.raw.codecLongName"
                      class="text-[10px] text-muted-foreground/80"
                    >
                      ({{ stream.raw.codecLongName }})
                    </span>
                  </span>
                </div>
                <div v-if="stream.isVideo">
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamResolution.tooltip') as string"
                  >
                    {{ t("media.fields.streamResolution.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    <template
                      v-if="stream.raw.width && stream.raw.height"
                    >
                      {{ stream.raw.width }}x{{ stream.raw.height }}
                    </template>
                    <template v-else>
                      -
                    </template>
                  </span>
                </div>
                <div v-if="stream.isVideo">
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamFrameRate.tooltip') as string"
                  >
                    {{ t("media.fields.streamFrameRate.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    {{ formatFrameRate(stream.raw.frameRate) }}
                  </span>
                </div>
                <div v-if="stream.isAudio">
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamSampleRate.tooltip') as string"
                  >
                    {{ t("media.fields.streamSampleRate.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    <template v-if="stream.raw.sampleRateHz">
                      {{ stream.raw.sampleRateHz }} Hz
                    </template>
                    <template v-else>
                      -
                    </template>
                  </span>
                </div>
                <div v-if="stream.isAudio">
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamChannels.tooltip') as string"
                  >
                    {{ t("media.fields.streamChannels.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    {{ stream.raw.channels ?? "-" }}
                  </span>
                </div>
                <div v-if="stream.isAudio">
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamLayout.tooltip') as string"
                  >
                    {{ t("media.fields.streamLayout.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    {{ stream.raw.channelLayout || "-" }}
                  </span>
                </div>
                <div>
                  <span
                    class="text-foreground/80"
                    :title="t('media.fields.streamBitRate.tooltip') as string"
                  >
                    {{ t("media.fields.streamBitRate.label") }}
                  </span>
                  <span class="ml-1 text-muted-foreground">
                    <template v-if="stream.raw.bitRateKbps">
                      {{ Math.round(stream.raw.bitRateKbps) }} kbps
                    </template>
                    <template v-else>
                      -
                    </template>
                  </span>
                </div>
              </div>

              <div
                v-if="stream.raw.tags && Object.keys(stream.raw.tags).length > 0"
                class="mt-2"
              >
                <p
                  class="text-foreground/80 mb-1"
                  :title="t('media.fields.streamTags.tooltip') as string"
                >
                  {{ t("media.fields.streamTags.label") }}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="[key, value] in Object.entries(stream.raw.tags)"
                    :key="key"
                    class="px-1.5 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground"
                  >
                    {{ key }}={{ value }}
                  </span>
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card
        v-if="hasRawJson"
        class="lg:col-span-2"
      >
        <CardHeader class="flex items-center justify-between gap-2">
          <CardTitle class="text-sm">
            {{ t("media.sections.raw") }}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
            :disabled="!hasRawJson"
            data-testid="copy-raw-json-btn"
            @click="copyRawJson"
          >
            {{ t("media.copyRawJson") }}
          </Button>
        </CardHeader>
        <CardContent class="text-xs">
          <div
            class="max-h-[420px] min-h-[220px] rounded border border-border/60 bg-muted/30 overflow-auto"
            data-testid="raw-json-viewer"
          >
            <pre
              class="p-3 font-mono whitespace-pre leading-relaxed min-w-full select-text text-[11px] md:text-[12px]"
              v-html="highlightedRawJsonHtml"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
