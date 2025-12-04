<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CompositeSmartScanTask, QueueProgressStyle } from "@/types";
import { Badge } from "@/components/ui/badge";
import { buildPreviewUrl } from "@/lib/backend";

const props = defineProps<{
  batch: CompositeSmartScanTask;
  size: "small" | "medium" | "large";
  progressStyle?: QueueProgressStyle;
}>();

const emit = defineEmits<{
  (e: "open-detail", batch: CompositeSmartScanTask): void;
}>();

const { t } = useI18n();

const effectiveProgressStyle = computed<QueueProgressStyle>(
  () => props.progressStyle ?? "bar",
);

const clampedProgress = computed(() =>
  Math.max(0, Math.min(100, props.batch.overallProgress ?? 0)),
);

const showBarProgress = computed(
  () => clampedProgress.value > 0 && effectiveProgressStyle.value === "bar",
);

const showCardFillProgress = computed(
  () => clampedProgress.value > 0 && effectiveProgressStyle.value === "card-fill",
);

const showRippleCardProgress = computed(
  () =>
    clampedProgress.value > 0 && effectiveProgressStyle.value === "ripple-card",
);

const rootSizeClass = computed(() => {
  if (props.size === "small") return "text-[10px]";
  if (props.size === "large") return "text-xs";
  return "text-[11px]";
});

const thumbnailAspectClass = computed(() => {
  // 与单个 QueueIconItem 一致，统一纵横比，只靠列数区分大小。
  return "pt-[75%]";
});

const captionPaddingClass = computed(() => {
  if (props.size === "small") return "px-2 py-1";
  if (props.size === "large") return "px-3 py-2";
  return "px-2 py-1.5";
});

type PreviewSlot = {
  key: string;
  previewPath: string | null;
};

const previewSlots = computed<PreviewSlot[]>(() => {
  const jobs = props.batch.jobs ?? [];
  const withPreview = jobs.filter((job) => !!job.previewPath);

  const slots: PreviewSlot[] = [];

  for (let index = 0; index < 9; index += 1) {
    const job =
      withPreview[index] ??
      jobs[index] ??
      null;

    if (job) {
      slots.push({
        key: job.id ?? `slot-${index}`,
        previewPath: job.previewPath ?? null,
      });
    } else {
      slots.push({
        key: `placeholder-${index}`,
        previewPath: null,
      });
    }
  }

  return slots;
});

const videosCount = computed(
  () => props.batch.jobs.filter((job) => job.type === "video").length,
);

const imagesCount = computed(
  () => props.batch.jobs.filter((job) => job.type === "image").length,
);

const folderName = computed(() => {
  const raw = props.batch.rootPath || "";
  if (!raw) return t("smartScan.title") as string;
  const normalized = raw.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments[segments.length - 1];
  return last || normalized;
});

const firstPreviewUrl = computed<string | null>(() => {
  const jobWithPreview = props.batch.jobs.find(
    (job) => typeof job.previewPath === "string" && job.previewPath.length > 0,
  );
  if (!jobWithPreview?.previewPath) return null;
  return buildPreviewUrl(jobWithPreview.previewPath);
});

const progressLabel = computed(() => `${Math.round(clampedProgress.value)}%`);

const onClick = () => {
  emit("open-detail", props.batch);
};
</script>

<template>
  <div
    class="relative rounded-lg border border-border/60 bg-card/80 overflow-hidden hover:border-primary/60 transition-colors cursor-pointer"
    :class="rootSizeClass"
    data-testid="queue-icon-batch-item"
    @click="onClick"
  >
    <div
      class="relative w-full bg-muted/40"
      :class="thumbnailAspectClass"
    >
      <div class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px bg-muted/40">
        <div
          v-for="slot in previewSlots"
          :key="slot.key"
          class="bg-background/40 overflow-hidden"
        >
          <img
            v-if="slot.previewPath"
            :src="buildPreviewUrl(slot.previewPath) ?? undefined"
            alt=""
            class="h-full w-full object-cover"
          />
          <div
            v-else
            class="h-full w-full bg-muted/60"
          />
        </div>
      </div>

      <div class="absolute top-1 left-1 flex items-center gap-1">
        <Badge
          variant="outline"
          class="px-1.5 py-0.5 text-[10px] font-medium border-blue-500/50 text-blue-200 bg-blue-500/15"
        >
          {{ t("queue.source.smartScan") }}
        </Badge>
        <span
          class="text-[10px] text-muted-foreground bg-background/80 rounded-full px-1.5 py-0.5"
        >
          {{ batch.totalProcessed }} / {{ batch.totalCandidates }}
        </span>
      </div>

      <div
        class="absolute top-1 right-1 text-[10px] font-mono text-muted-foreground bg-background/80 rounded-full px-1.5 py-0.5"
      >
        {{ progressLabel }}
      </div>
    </div>

    <div
      class="relative border-t border-border/40 bg-card/80 overflow-hidden"
      :class="captionPaddingClass"
    >
      <!-- 在网格视图中，进度通过底部说明区域的背景表现，避免覆盖预览九宫格。 -->
      <div
        v-if="showBarProgress"
        class="absolute inset-y-0 left-0 bg-primary/40"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-bar"
      />
      <div
        v-else-if="showCardFillProgress"
        class="absolute inset-y-0 left-0 overflow-hidden"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-card-fill"
      >
        <img
          v-if="firstPreviewUrl"
          :src="firstPreviewUrl"
          alt=""
          class="h-full w-full object-cover opacity-80"
        />
        <div
          v-else
          class="h-full w-full bg-gradient-to-r from-card/40 via-card/20 to-card/0"
        />
      </div>
      <div
        v-else-if="showRippleCardProgress"
        class="absolute inset-y-0 left-0"
        :style="{ width: `${clampedProgress}%` }"
        data-testid="queue-icon-batch-progress-ripple-card"
      >
        <div
          class="h-full w-full bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30 opacity-80 animate-pulse"
        />
      </div>

      <p
        class="relative truncate text-[11px] font-medium text-foreground"
        :title="folderName"
      >
        {{ folderName }}
      </p>
      <p class="relative mt-0.5 text-[10px] text-muted-foreground truncate">
        {{ videosCount }} {{ t("queue.typeVideo") }} / {{ imagesCount }} {{ t("queue.typeImage") }} ·
        {{ t("queue.status.completed") }} {{ batch.completedCount }} / {{ batch.totalCount }}
      </p>
    </div>
  </div>
</template>
