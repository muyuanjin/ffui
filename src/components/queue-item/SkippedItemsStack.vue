<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import { buildPreviewUrl } from "@/lib/backend";
import { Badge } from "@/components/ui/badge";
import { Film, Image, Music } from "lucide-vue-next";

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

// 计算显示的任务列表（限制最大显示数量）
const displayedJobs = computed(() => {
  return props.skippedJobs.slice(0, Math.min(props.skippedJobs.length, 20));
});

// 获取任务的预览图 URL
const getPreviewUrl = (job: TranscodeJob): string | null => {
  if (job.previewPath) return buildPreviewUrl(job.previewPath);
  if (job.type === "image") {
    return buildPreviewUrl(job.outputPath || job.inputPath || null);
  }
  return null;
};

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
    baseOffset = relativeIndex - dragOffset.value / 100;
  }

  // 计算旋转角度和位移
  const rotateY = Math.max(-60, Math.min(60, baseOffset * 15));
  const translateX = baseOffset * 40;
  const translateZ = -Math.abs(baseOffset) * 30;
  const scale = Math.max(0.7, 1 - Math.abs(baseOffset) * 0.08);
  const opacity = Math.max(0.3, 1 - Math.abs(baseOffset) * 0.2);

  // 控制 z-index，当前活跃卡片在最上层
  const zIndex = totalCards - Math.abs(relativeIndex);

  // 非活跃卡片稍微向后倾斜
  const rotateX = Math.abs(baseOffset) > 0.5 ? 5 : 0;

  return {
    transform: `
      perspective(1000px)
      translateX(${translateX}px)
      translateZ(${translateZ}px)
      rotateY(${rotateY}deg)
      rotateX(${rotateX}deg)
      scale(${scale})
    `,
    opacity,
    zIndex,
    transition: isDragging.value ? "none" : "all 0.4s cubic-bezier(0.23, 1, 0.32, 1)",
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
  const threshold = 50;
  if (Math.abs(dragOffset.value) > threshold) {
    if (dragOffset.value > 0 && activeIndex.value > 0) {
      // 向右滑动，显示前一张
      activeIndex.value--;
    } else if (dragOffset.value < 0 && activeIndex.value < displayedJobs.value.length - 1) {
      // 向左滑动，显示后一张
      activeIndex.value++;
    }
  }
  dragOffset.value = 0;
  (e.target as HTMLElement)?.releasePointerCapture(e.pointerId);
};

// 鼠标滚轮事件处理
const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (e.deltaX > 20 || e.deltaY > 20) {
    if (activeIndex.value < displayedJobs.value.length - 1) {
      activeIndex.value++;
    }
  } else if (e.deltaX < -20 || e.deltaY < -20) {
    if (activeIndex.value > 0) {
      activeIndex.value--;
    }
  }
};

// 点击卡片跳转
const handleCardClick = (index: number) => {
  if (isDragging.value) return;
  activeIndex.value = index;
};

// 键盘导航
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "ArrowLeft" && activeIndex.value > 0) {
    activeIndex.value--;
  } else if (e.key === "ArrowRight" && activeIndex.value < displayedJobs.value.length - 1) {
    activeIndex.value++;
  }
};

onMounted(() => {
  containerRef.value?.addEventListener("wheel", handleWheel, { passive: false });
});

onUnmounted(() => {
  containerRef.value?.removeEventListener("wheel", handleWheel);
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
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">{{ t("queue.status.skipped") }}</span>
        <Badge variant="secondary" class="text-[10px] px-1.5 py-0">
          {{ skippedJobs.length }}
        </Badge>
      </div>
      <span class="text-[10px] text-muted-foreground"> {{ activeIndex + 1 }} / {{ displayedJobs.length }} </span>
    </div>

    <!-- 卡片堆叠区域 -->
    <div class="relative h-32 flex items-center justify-center overflow-visible">
      <template v-for="(job, index) in displayedJobs" :key="job.id">
        <div
          v-if="isCardVisible(index)"
          class="skipped-card absolute w-48 h-28 rounded-lg border border-border/60 bg-card/95 shadow-lg overflow-hidden cursor-pointer hover:border-primary/40"
          :class="{ 'ring-1 ring-primary/50': index === activeIndex }"
          :style="getCardStyle(index)"
          @click="handleCardClick(index)"
        >
          <!-- 预览图或占位 -->
          <div class="relative h-16 bg-muted/40 overflow-hidden">
            <img
              v-if="getPreviewUrl(job)"
              :src="getPreviewUrl(job) ?? undefined"
              alt=""
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <component :is="getTypeIcon(job.type)" class="h-8 w-8 text-muted-foreground/40" />
            </div>

            <!-- 类型标签 -->
            <Badge variant="secondary" class="absolute top-1 left-1 px-1 py-0 text-[9px] bg-background/80">
              {{ getTypeLabel(job.type) }}
            </Badge>
          </div>

          <!-- 信息区域 -->
          <div class="px-2 py-1.5 space-y-0.5">
            <p class="text-[10px] font-medium text-foreground truncate" :title="job.filename">
              {{ job.filename?.split(/[/\\]/).pop() }}
            </p>
            <p v-if="job.skipReason" class="text-[9px] text-amber-400 truncate" :title="job.skipReason">
              {{ job.skipReason }}
            </p>
          </div>
        </div>
      </template>
    </div>

    <!-- 导航指示器 -->
    <div v-if="displayedJobs.length > 1" class="flex justify-center gap-1 mt-3">
      <button
        v-for="(_, index) in displayedJobs.slice(0, 10)"
        :key="index"
        class="w-1.5 h-1.5 rounded-full transition-all"
        :class="index === activeIndex ? 'bg-primary scale-125' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        @click="activeIndex = index"
      />
      <span v-if="displayedJobs.length > 10" class="text-[9px] text-muted-foreground ml-1">
        +{{ displayedJobs.length - 10 }}
      </span>
    </div>

    <!-- 操作提示 -->
    <p class="text-center text-[9px] text-muted-foreground/60 mt-2">
      {{ t("queue.skippedStackHint") }}
    </p>
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
