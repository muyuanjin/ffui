<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, reactive } from "vue";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, buildPreviewUrl, ensureJobPreview, hasTauri, revealPathInFolder } from "@/lib/backend";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { createWheelSoftSnapController } from "@/lib/wheelSoftSnap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseSkippedJobReason } from "./skippedItemsStack.helpers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Film, Image, Music, Copy, FolderOpen } from "lucide-vue-next";

const props = defineProps<{
  /** 跳过的任务列表 */
  skippedJobs: TranscodeJob[];
  /** 最大显示的叠放层数 */
  maxStackLayers?: number;
}>();

const { t } = useI18n();

const maxLayers = computed(() => props.maxStackLayers ?? 5);

// 当前展开/活跃的卡片索引
const activeIndex = ref(0);
// 是否处于拖拽/滑动状态
const isDragging = ref(false);
// 拖拽起始位置
const dragStartX = ref(0);
// 当前拖拽偏移量
const dragOffset = ref(0);
// 组件容器引用
const containerRef = ref<HTMLElement | null>(null);

const wheelSnap = createWheelSoftSnapController({
  // Keep it responsive to trackpads/mice; the skipped stack is small so a lower threshold feels better.
  getThresholdPx: () => 36,
  getPageSizePx: () => containerRef.value?.clientHeight ?? 240,
  minIntervalMs: 35,
  gestureResetMs: 150,
  maxAccumulatedPx: 900,
});

// 预览图缓存（按 job id 存储生成的预览路径）
const previewCache = reactive<Record<string, string | null>>({});

// 右键菜单状态
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuJob = ref<TranscodeJob | null>(null);

const handleCardContextMenu = (e: MouseEvent, job: TranscodeJob) => {
  e.preventDefault();
  e.stopPropagation();
  contextMenuJob.value = job;
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  contextMenuVisible.value = true;
};

const closeContextMenu = () => {
  contextMenuVisible.value = false;
};

const onCopyInputPath = async () => {
  if (contextMenuJob.value?.inputPath) {
    await copyToClipboard(contextMenuJob.value.inputPath);
  }
  closeContextMenu();
};

const onOpenInputFolder = async () => {
  if (contextMenuJob.value?.inputPath) {
    await revealPathInFolder(contextMenuJob.value.inputPath);
  }
  closeContextMenu();
};

// 计算菜单位置（避免超出视口）
const clampedMenuPosition = computed(() => {
  const padding = 8;
  const menuWidth = 180;
  const menuHeight = 80;

  const maxLeft = Math.max(padding, window.innerWidth - menuWidth - padding);
  const maxTop = Math.max(padding, window.innerHeight - menuHeight - padding);

  return {
    x: Math.min(Math.max(contextMenuX.value, padding), maxLeft),
    y: Math.min(Math.max(contextMenuY.value, padding), maxTop),
  };
});

// 计算显示的任务列表（限制最大显示数量）
const displayedJobs = computed(() => {
  return props.skippedJobs.slice(0, Math.min(props.skippedJobs.length, 20));
});

watch(
  () => displayedJobs.value.length,
  (len) => {
    if (len <= 0) {
      activeIndex.value = 0;
      return;
    }
    activeIndex.value = ((activeIndex.value % len) + len) % len;
  },
  { immediate: true },
);

const parseSkipReason = (reason: string | undefined, jobType: string): string => {
  return parseSkippedJobReason({
    reason,
    jobType,
    t: (key, values) => (values ? (t(key, values) as string) : (t(key) as string)),
  });
};

/**
 * 获取任务的预览图 URL（优先使用缓存）
 */
const getPreviewUrl = (job: TranscodeJob): string | null => {
  // 优先使用缓存
  if (previewCache[job.id]) {
    return buildJobPreviewUrl(previewCache[job.id], job.previewRevision);
  }

  // 已有预览路径
  if (job.previewPath) {
    return buildJobPreviewUrl(job.previewPath, job.previewRevision);
  }

  // 图片类型可以使用输入/输出路径
  if (job.type === "image") {
    return buildPreviewUrl(job.outputPath || job.inputPath || null);
  }

  return null;
};

/**
 * 为视频任务生成预览图（按需懒加载）
 */
const ensurePreviewForJob = async (job: TranscodeJob) => {
  // 已有预览或已缓存，跳过
  if (job.previewPath || previewCache[job.id] || job.type !== "video") {
    return;
  }

  // 非 Tauri 环境跳过
  if (!hasTauri()) {
    return;
  }

  try {
    const path = await ensureJobPreview(job.id);
    if (path) {
      previewCache[job.id] = path;
    }
  } catch {
    // 静默失败
  }
};

// 当活跃索引变化时，预加载当前卡片及相邻卡片的预览图
watch(
  activeIndex,
  (newIndex) => {
    const jobs = displayedJobs.value;
    // 预加载当前及前后各 2 张
    for (let i = Math.max(0, newIndex - 2); i <= Math.min(jobs.length - 1, newIndex + 2); i++) {
      ensurePreviewForJob(jobs[i]);
    }
  },
  { immediate: true },
);

// 获取任务类型图标
const getTypeIcon = (type: string) => {
  switch (type) {
    case "video":
      return Film;
    case "image":
      return Image;
    case "audio":
      return Music;
    default:
      return Film;
  }
};

// 获取任务类型标签
const getTypeLabel = (type: string) => {
  switch (type) {
    case "video":
      return t("queue.typeVideo");
    case "image":
      return t("queue.typeImage");
    case "audio":
      return t("queue.typeAudio");
    default:
      return type;
  }
};

// 计算卡片的变换样式（3D 唱片机效果）
const getCardStyle = (index: number) => {
  const relativeIndex = index - activeIndex.value;
  const totalCards = displayedJobs.value.length;

  // 基础偏移量（拖拽时动态调整）
  let baseOffset = relativeIndex;
  if (isDragging.value) {
    baseOffset = relativeIndex - dragOffset.value / 80;
  }

  // 计算旋转角度和位移
  const rotateY = Math.max(-70, Math.min(70, baseOffset * 18));
  const translateX = baseOffset * 60;
  const translateZ = -Math.abs(baseOffset) * 40;
  const scale = Math.max(0.65, 1 - Math.abs(baseOffset) * 0.1);
  const opacity = Math.max(0.25, 1 - Math.abs(baseOffset) * 0.25);

  // 控制 z-index，当前活跃卡片在最上层
  const zIndex = totalCards - Math.abs(relativeIndex);

  // 非活跃卡片稍微向后倾斜
  const rotateX = Math.abs(baseOffset) > 0.5 ? 6 : 0;

  return {
    transform: `
      perspective(800px)
      translateX(${translateX}px)
      translateZ(${translateZ}px)
      rotateY(${rotateY}deg)
      rotateX(${rotateX}deg)
      scale(${scale})
    `,
    opacity,
    zIndex,
    transition: isDragging.value
      ? "none"
      : "transform 0.35s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.35s cubic-bezier(0.23, 1, 0.32, 1)",
  };
};

// 判断卡片是否可见（优化性能）
const isCardVisible = (index: number) => {
  const relativeIndex = Math.abs(index - activeIndex.value);
  return relativeIndex <= maxLayers.value;
};

// 鼠标/触摸事件处理
const handlePointerDown = (e: PointerEvent) => {
  isDragging.value = true;
  dragStartX.value = e.clientX;
  dragOffset.value = 0;
  (e.target as HTMLElement)?.setPointerCapture(e.pointerId);
};

const handlePointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return;
  dragOffset.value = e.clientX - dragStartX.value;
};

const handlePointerUp = (e: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;

  // 根据拖拽距离决定是否切换卡片
  const threshold = 40;
  const len = displayedJobs.value.length;
  if (Math.abs(dragOffset.value) > threshold && len > 0) {
    if (dragOffset.value > 0) {
      activeIndex.value = (activeIndex.value - 1 + len) % len;
    } else {
      activeIndex.value = (activeIndex.value + 1) % len;
    }
  }
  dragOffset.value = 0;
  (e.target as HTMLElement)?.releasePointerCapture(e.pointerId);
};

// 鼠标滚轮事件处理
const handleWheel = (e: WheelEvent) => {
  const len = displayedJobs.value.length;
  if (len <= 1) return;

  wheelSnap.onWheel(e, {
    shouldConsume: () => true,
    onStep: (direction) => {
      if (len === 0) return false;
      if (direction > 0) {
        activeIndex.value = (activeIndex.value + 1) % len;
      } else {
        activeIndex.value = (activeIndex.value - 1 + len) % len;
      }
      return true;
    },
  });
};

// 点击卡片跳转
const handleCardClick = (index: number) => {
  if (isDragging.value) return;
  activeIndex.value = index;
};

// 键盘导航
const handleKeyDown = (e: KeyboardEvent) => {
  const len = displayedJobs.value.length;
  if (len === 0) return;
  if (e.key === "ArrowLeft") {
    activeIndex.value = (activeIndex.value - 1 + len) % len;
  } else if (e.key === "ArrowRight") {
    activeIndex.value = (activeIndex.value + 1) % len;
  }
};

onMounted(() => {
  containerRef.value?.addEventListener("wheel", handleWheel, { passive: false });
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("wheel", handleWheel);
  wheelSnap.reset();
});
</script>

<template>
  <div
    v-if="displayedJobs.length > 0"
    ref="containerRef"
    class="skipped-stack-container relative select-none"
    tabindex="0"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerUp"
    @keydown="handleKeyDown"
  >
    <!-- 标题栏 -->
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted-foreground">{{ t("queue.status.skipped") }}</span>
        <Badge variant="secondary" class="text-[9px] px-1 py-0 h-4">
          {{ skippedJobs.length }}
        </Badge>
      </div>
      <span data-testid="ffui-skipped-stack-position" class="text-[9px] text-muted-foreground/70">
        {{ activeIndex + 1 }} / {{ displayedJobs.length }}
      </span>
    </div>

    <!-- 卡片堆叠区域 -->
    <div class="relative h-40 flex items-center justify-center overflow-visible">
      <template v-for="(job, index) in displayedJobs" :key="job.id">
        <div
          v-if="isCardVisible(index)"
          class="skipped-card absolute w-56 h-36 rounded-lg border border-border/60 bg-card/95 shadow-lg overflow-hidden cursor-pointer hover:border-primary/40"
          :class="{ 'ring-1 ring-primary/50': index === activeIndex }"
          :style="getCardStyle(index)"
          @click="handleCardClick(index)"
          @contextmenu="handleCardContextMenu($event, job)"
        >
          <!-- 预览图 -->
          <div class="relative h-24 bg-muted/40 overflow-hidden">
            <img
              v-if="getPreviewUrl(job)"
              :src="getPreviewUrl(job) ?? undefined"
              alt=""
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <component :is="getTypeIcon(job.type)" class="h-10 w-10 text-muted-foreground/40" />
            </div>

            <!-- 类型标签 -->
            <Badge variant="secondary" class="absolute top-1 left-1 px-1 py-0 text-[9px] bg-background/80">
              {{ getTypeLabel(job.type) }}
            </Badge>
          </div>

          <!-- 信息区域 -->
          <div class="px-2 py-1 space-y-0.5">
            <p class="text-[10px] font-medium text-foreground truncate" :title="job.filename">
              {{ job.filename?.split(/[/\\]/).pop() }}
            </p>
            <p
              v-if="job.skipReason"
              class="text-[9px] text-amber-400 truncate"
              :title="parseSkipReason(job.skipReason, job.type)"
            >
              {{ parseSkipReason(job.skipReason, job.type) }}
            </p>
          </div>
        </div>
      </template>
    </div>

    <!-- 导航指示器 -->
    <div v-if="displayedJobs.length > 1" class="flex justify-center items-center gap-0.5 mt-1">
      <button
        v-for="(_, index) in displayedJobs.slice(0, 10)"
        :key="index"
        class="w-1 h-1 rounded-full transition-all"
        :class="index === activeIndex ? 'bg-primary w-2' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        @click="activeIndex = index"
      />
      <span v-if="displayedJobs.length > 10" class="text-[8px] text-muted-foreground/60 ml-0.5">
        +{{ displayedJobs.length - 10 }}
      </span>
    </div>

    <!-- 操作提示 -->
    <p class="text-center text-[8px] text-muted-foreground/50 mt-0.5">
      {{ t("queue.skippedStackHint") }}
    </p>

    <!-- 右键菜单 -->
    <div v-if="contextMenuVisible" class="fixed inset-0 z-40" @click="closeContextMenu" @contextmenu.prevent>
      <DropdownMenu :open="contextMenuVisible" @update:open="(v) => !v && closeContextMenu()">
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="fixed z-40 h-1 w-1 p-0 opacity-0"
            :style="{ left: `${clampedMenuPosition.x}px`, top: `${clampedMenuPosition.y}px` }"
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover text-xs shadow-md py-1"
          :side-offset="4"
          :portal-disabled="true"
          data-stop-clear-selection="true"
        >
          <DropdownMenuItem class="px-3 py-1.5 text-xs gap-2" @select="onCopyInputPath">
            <Copy class="h-4 w-4 opacity-80 text-primary" aria-hidden="true" />
            {{ t("queue.actions.copyInputPath") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="!contextMenuJob?.inputPath"
            class="px-3 py-1.5 text-xs gap-2"
            @select="onOpenInputFolder"
          >
            <FolderOpen class="h-4 w-4 opacity-80 text-primary" aria-hidden="true" />
            {{ t("queue.actions.openInputFolder") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

<style scoped>
.skipped-stack-container {
  touch-action: pan-y;
}

.skipped-card {
  backface-visibility: hidden;
  will-change: transform, opacity;
}

.skipped-stack-container:focus {
  outline: none;
}

.skipped-stack-container:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
  border-radius: 0.5rem;
}
</style>
