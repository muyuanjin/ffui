<script setup lang="ts">
import { computed, toRef, watch } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import FallbackMediaPreview from "@/components/media/FallbackMediaPreview.vue";
import { cleanupFallbackPreviewFramesAsync, hasTauri } from "@/lib/backend";
import type { PreviewSourceMode } from "@/composables/main-app/useMainAppPreview";

const props = defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The job to preview */
  job: TranscodeJob | null;
  /** Which source the user selected for preview. */
  previewSourceMode: PreviewSourceMode;
  /** Preview URL (may be different from job.previewPath for Tauri file:// URLs) */
  previewUrl: string | null;
  /** Underlying raw filesystem path currently being previewed (used for FFmpeg fallback) */
  previewPath: string | null;
  /** Whether the preview is an image */
  isImage: boolean;
  /** Error message to display */
  error: string | null;
}>();

const open = toRef(props, "open");
const job = toRef(props, "job");
const previewUrl = toRef(props, "previewUrl");
const previewPath = toRef(props, "previewPath");
const isImage = toRef(props, "isImage");
const error = toRef(props, "error");
const previewSourceMode = toRef(props, "previewSourceMode");

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:previewSourceMode": [value: PreviewSourceMode];
  videoError: [];
  imageError: [];
  openInSystemPlayer: [];
  copyPath: [];
}>();

const { t } = useI18n();

type ResolvedPreviewSource = "input" | "output" | "tmpOutput" | "unknown";

const titlePath = computed(() => {
  return (previewPath.value ?? job.value?.filename ?? "").trim() || (t("jobDetail.preview") as string);
});

const canSelectInput = computed(() => {
  return !!String(job.value?.inputPath ?? "").trim();
});

const canSelectOutput = computed(() => {
  const jobValue = job.value;
  if (!jobValue) return false;

  const outputPath = String(jobValue.outputPath ?? "").trim();
  const tmpOutputPath = String(jobValue.waitMetadata?.tmpOutputPath ?? "").trim();

  // For in-flight jobs, only tmp output is a valid output preview target.
  if (jobValue.status !== "completed" && jobValue.status !== "failed") {
    return !!tmpOutputPath;
  }

  return !!outputPath || !!tmpOutputPath;
});

const outputDisabledReason = computed(() => {
  const jobValue = job.value;
  if (!jobValue) return "";
  if (canSelectOutput.value) return "";
  if (jobValue.status !== "completed" && jobValue.status !== "failed") {
    return t("jobDetail.outputNotReady") as string;
  }
  return t("jobDetail.outputNotAvailable") as string;
});

const resolvedPreviewSource = computed<ResolvedPreviewSource>(() => {
  const jobValue = job.value;
  const path = (previewPath.value ?? "").trim();
  if (!jobValue || !path) return "unknown";

  const outputPath = (jobValue.outputPath ?? "").trim();
  const inputPath = (jobValue.inputPath ?? "").trim();

  // When input/output are the same (e.g. "replace original"), keep the label
  // aligned with the user's selected mode to avoid confusing "same file" cases.
  if (outputPath && inputPath && outputPath === inputPath && path === outputPath) {
    return previewSourceMode.value === "input" ? "input" : "output";
  }

  if (outputPath && path === outputPath) return "output";
  if (inputPath && path === inputPath) return "input";

  const tmp = jobValue.waitMetadata?.tmpOutputPath;
  if (tmp && path === tmp) return "tmpOutput";

  return "unknown";
});

const resolvedPreviewSourceLabel = computed(() => {
  switch (resolvedPreviewSource.value) {
    case "output":
      return t("jobDetail.previewSource.output") as string;
    case "input":
      return t("jobDetail.previewSource.input") as string;
    case "tmpOutput":
      return t("jobDetail.previewSource.tmpOutput") as string;
    default:
      return t("jobDetail.previewSource.unknown") as string;
  }
});

const descriptionText = computed(() => {
  return t("jobDetail.previewDescriptionWithSource", {
    source: resolvedPreviewSourceLabel.value,
  }) as string;
});

const previewSourceModeModel = computed<PreviewSourceMode>({
  get: () => previewSourceMode.value,
  set: (value) => emit("update:previewSourceMode", value),
});

const videoSourcePath = computed(() => {
  return previewPath.value || null;
});

const forceFallback = computed(() => !isImage.value && !!error.value);

watch(
  () => props.open,
  (open, prev) => {
    if (prev && !open && hasTauri()) {
      void cleanupFallbackPreviewFramesAsync();
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="sm:max-w-4xl max-h-[calc(100vh-2rem)] overflow-x-hidden overflow-y-auto"
      data-testid="expanded-preview-dialog"
    >
      <DialogHeader>
        <DialogTitle class="text-base">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex items-center gap-2">
              <span class="min-w-0 truncate">
                {{ titlePath }}
              </span>
              <Badge
                variant="outline"
                data-testid="expanded-preview-source-badge"
                class="shrink-0 border-border/40 bg-background/40 text-[10px] font-medium px-2 py-0.5"
              >
                {{ resolvedPreviewSourceLabel }}
              </Badge>
            </div>
            <Tabs v-model="previewSourceModeModel" activation-mode="manual" class="shrink-0">
              <TabsList class="h-6 bg-background/50 border border-border/30 p-0.5">
                <TabsTrigger
                  value="input"
                  data-testid="expanded-preview-source-input"
                  class="h-5 px-2 text-[10px] leading-none"
                  :disabled="!canSelectInput"
                >
                  {{ t("jobDetail.previewSourceMode.input") }}
                </TabsTrigger>
                <TabsTrigger
                  value="output"
                  data-testid="expanded-preview-source-output"
                  class="h-5 px-2 text-[10px] leading-none"
                  :disabled="!canSelectOutput"
                  :title="outputDisabledReason"
                >
                  {{ t("jobDetail.previewSourceMode.output") }}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </DialogTitle>
        <DialogDescription class="text-[11px] text-muted-foreground">
          {{ descriptionText }}
        </DialogDescription>
      </DialogHeader>
      <div
        class="mt-2 relative w-full max-h-[70vh] aspect-video rounded-md bg-black flex items-center justify-center overflow-hidden"
        data-testid="expanded-preview-surface"
      >
        <template v-if="previewUrl">
          <img
            v-if="isImage"
            :src="previewUrl"
            alt=""
            class="w-full h-full object-contain"
            @error="emit('imageError')"
          />
          <FallbackMediaPreview
            v-else
            :native-url="previewUrl"
            :source-path="videoSourcePath"
            :duration-seconds="job?.mediaInfo?.durationSeconds ?? null"
            :autoplay="true"
            :lazy-controls="true"
            :auto-fallback-on-native-error="false"
            :force-fallback="forceFallback"
            :error-text="error"
            :show-copy-path-action="true"
            video-test-id="task-detail-expanded-video"
            @native-error="emit('videoError')"
            @open-in-system-player="emit('openInSystemPlayer')"
            @copy-path="emit('copyPath')"
          />
        </template>
        <p v-else data-testid="task-detail-expanded-fallback" class="text-[11px] text-muted-foreground">
          {{ t("jobDetail.noPreview") }}
        </p>
      </div>
      <div v-if="error && isImage" class="mt-2 text-[11px] text-destructive">
        <p>{{ error }}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="xs" class="h-6 px-2 text-[10px]" @click="emit('openInSystemPlayer')">
            {{ t("jobDetail.openInSystemPlayer") }}
          </Button>
          <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('copyPath')">
            {{ t("jobDetail.copyPath") }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
