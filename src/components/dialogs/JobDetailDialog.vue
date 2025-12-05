<script setup lang="ts">
import { computed, ref } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "vue-i18n";
import { highlightFfmpegCommand } from "@/lib/ffmpegCommand";
import type { TranscodeJob, FFmpegPreset } from "@/types";

const props = defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The job to display */
  job: TranscodeJob | null;
  /** The preset used for this job */
  preset: FFmpegPreset | null;
  /** Highlighted log HTML */
  highlightedLogHtml: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  expandPreview: [];
  copyCommand: [command: string];
}>();

const { t } = useI18n();

const activeTab = ref<"preview" | "info" | "command" | "log">("preview");

const statusBadgeClass = computed(() => {
  if (!props.job) return "";
  const status = props.job.status;
  if (status === "completed") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
  if (status === "processing") return "bg-blue-500/20 text-blue-400 border-blue-500/40";
  if (status === "failed") return "bg-destructive/20 text-destructive border-destructive/40";
  if (status === "cancelled") return "bg-orange-500/20 text-orange-400 border-orange-500/40";
  if (status === "waiting" || status === "queued") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  if (status === "paused") return "bg-purple-500/20 text-purple-400 border-purple-500/40";
  if (status === "skipped") return "bg-gray-500/20 text-gray-400 border-gray-500/40";
  return "bg-muted text-muted-foreground border-border";
});

const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes == null || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds == null || seconds <= 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const copyToClipboard = async (value: string | undefined | null) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Fallback
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-4xl max-h-[90vh] flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-3">
          <span class="truncate max-w-md">{{ job?.filename || t("jobDetail.title") }}</span>
          <Badge v-if="job" variant="outline" :class="statusBadgeClass">
            {{ t(`queue.status.${job.status}`) }}
          </Badge>
        </DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground truncate">
          {{ job?.inputPath || "" }}
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0">
        <TabsList class="grid w-full grid-cols-4">
          <TabsTrigger value="preview">{{ t("jobDetail.tabs.preview") }}</TabsTrigger>
          <TabsTrigger value="info">{{ t("jobDetail.tabs.info") }}</TabsTrigger>
          <TabsTrigger value="command">{{ t("jobDetail.tabs.command") }}</TabsTrigger>
          <TabsTrigger value="log">{{ t("jobDetail.tabs.log") }}</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" class="flex-1 min-h-0">
          <div class="h-full flex items-center justify-center bg-muted/30 rounded-lg">
            <div v-if="job?.previewPath" class="relative group">
              <img
                v-if="job.type === 'image'"
                :src="job.previewPath"
                :alt="job.filename"
                class="max-h-[400px] max-w-full object-contain rounded-lg cursor-pointer"
                @click="emit('expandPreview')"
              />
              <video
                v-else
                :src="job.previewPath"
                class="max-h-[400px] max-w-full object-contain rounded-lg cursor-pointer"
                controls
                @click.stop="emit('expandPreview')"
              />
              <Button
                variant="secondary"
                size="sm"
                class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="emit('expandPreview')"
              >
                {{ t("jobDetail.expandPreview") }}
              </Button>
            </div>
            <div v-else class="text-muted-foreground text-sm">
              {{ t("jobDetail.noPreview") }}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="info" class="flex-1 min-h-0 overflow-auto">
          <div class="space-y-4 text-sm">
            <div class="grid grid-cols-2 gap-4">
              <div class="space-y-2">
                <h4 class="font-semibold text-foreground">{{ t("jobDetail.inputInfo") }}</h4>
                <div class="space-y-1 text-xs text-muted-foreground">
                  <p><span class="text-foreground/80">{{ t("jobDetail.path") }}:</span> {{ job?.inputPath || "-" }}</p>
                  <p><span class="text-foreground/80">{{ t("jobDetail.size") }}:</span> {{ formatBytes((job?.originalSizeMB ?? 0) * 1024 * 1024) }}</p>
                  <p v-if="job?.mediaInfo?.durationSeconds">
                    <span class="text-foreground/80">{{ t("jobDetail.duration") }}:</span> {{ formatDuration(job.mediaInfo.durationSeconds) }}
                  </p>
                  <p v-if="job?.mediaInfo?.width && job?.mediaInfo?.height">
                    <span class="text-foreground/80">{{ t("jobDetail.resolution") }}:</span> {{ job.mediaInfo.width }}x{{ job.mediaInfo.height }}
                  </p>
                  <p v-if="job?.mediaInfo?.videoCodec">
                    <span class="text-foreground/80">{{ t("jobDetail.codec") }}:</span> {{ job.mediaInfo.videoCodec }}
                  </p>
                  <p v-if="job?.mediaInfo?.audioCodec">
                    <span class="text-foreground/80">{{ t("jobDetail.audioCodec") }}:</span> {{ job.mediaInfo.audioCodec }}
                  </p>
                </div>
              </div>
              <div class="space-y-2">
                <h4 class="font-semibold text-foreground">{{ t("jobDetail.outputInfo") }}</h4>
                <div class="space-y-1 text-xs text-muted-foreground">
                  <p><span class="text-foreground/80">{{ t("jobDetail.path") }}:</span> {{ job?.outputPath || "-" }}</p>
                  <p><span class="text-foreground/80">{{ t("jobDetail.size") }}:</span> {{ formatBytes((job?.outputSizeMB ?? 0) * 1024 * 1024) }}</p>
                  <p v-if="job?.originalSizeMB && job?.outputSizeMB && job.outputSizeMB > 0">
                    <span class="text-foreground/80">{{ t("jobDetail.ratio") }}:</span>
                    {{ ((1 - job.outputSizeMB / job.originalSizeMB) * 100).toFixed(1) }}%
                  </p>
                </div>
              </div>
            </div>

            <div v-if="preset" class="space-y-2">
              <h4 class="font-semibold text-foreground">{{ t("jobDetail.presetInfo") }}</h4>
              <div class="space-y-1 text-xs text-muted-foreground">
                <p><span class="text-foreground/80">{{ t("jobDetail.presetName") }}:</span> {{ preset.name }}</p>
                <p><span class="text-foreground/80">{{ t("jobDetail.encoder") }}:</span> {{ preset.video.encoder }}</p>
                <p><span class="text-foreground/80">{{ t("jobDetail.rateControl") }}:</span> {{ preset.video.rateControl.toUpperCase() }} {{ preset.video.qualityValue }}</p>
              </div>
            </div>

            <div v-if="job?.skipReason" class="space-y-2">
              <h4 class="font-semibold text-destructive">{{ t("jobDetail.error") }}</h4>
              <pre class="text-xs text-destructive bg-destructive/10 rounded-md p-2 whitespace-pre-wrap">{{ job.skipReason }}</pre>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="command" class="flex-1 min-h-0 flex flex-col">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted-foreground">FFmpeg {{ t("jobDetail.command") }}</span>
            <Button
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              @click="copyToClipboard(job?.ffmpegCommand)"
            >
              {{ t("jobDetail.copyCommand") }}
            </Button>
          </div>
          <ScrollArea class="flex-1 rounded-md border border-border bg-muted/30">
            <pre
              class="p-3 text-xs font-mono whitespace-pre-wrap break-all select-text"
              v-html="highlightFfmpegCommand(job?.ffmpegCommand || '')"
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="log" class="flex-1 min-h-0 flex flex-col">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted-foreground">{{ t("jobDetail.logTitle") }}</span>
            <Button
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              @click="copyToClipboard(job?.logs?.join('\n'))"
            >
              {{ t("jobDetail.copyLog") }}
            </Button>
          </div>
          <ScrollArea class="flex-1 rounded-md border border-border bg-background/95">
            <div
              class="p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all select-text"
              v-html="highlightedLogHtml"
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
