<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "vue-i18n";
import type { QueueFilterStatus, QueueFilterKind } from "@/composables";
import { X, RotateCcw } from "lucide-vue-next";

const props = defineProps<{
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
}>();

const emit = defineEmits<{
  (e: "toggle-type-filter", kind: QueueFilterKind): void;
  (e: "toggle-status-filter", status: QueueFilterStatus): void;
  (e: "update:filterText", value: string): void;
  (e: "toggle-filter-regex-mode"): void;
  (e: "reset-queue-filters"): void;
}>();

const { t } = useI18n();

const examplesOpen = ref(false);

const textPlaceholder = computed(() =>
  props.filterUseRegex ? t("queue.filters.textPlaceholderRegex") : t("queue.filters.textPlaceholderTokens"),
);

const exampleLines = computed<string[]>(() => {
  if (props.filterUseRegex) {
    return ["^.*\\.mp4$", "movie|demo", "building.*"];
  }
  return ["movie", "movie 1080p", "size>20mb", "regex:.*movie.*"];
});

const examplesHint = computed(() =>
  props.filterUseRegex ? t("queue.filters.textExamplesHintRegex") : t("queue.filters.textExamplesHintTokens"),
);

const closeExamples = () => {
  examplesOpen.value = false;
};

// 状态筛选选项
const statusOptions: QueueFilterStatus[] = [
  "processing",
  "queued",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "skipped",
];
</script>

<template>
  <div class="px-3 py-2 space-y-2">
    <!-- 类型筛选 -->
    <div class="flex items-start gap-2">
      <span class="text-xs text-muted-foreground mt-1 min-w-[48px]">
        {{ t("queue.filters.typeLabel") }}
      </span>
      <div class="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-xs rounded-md transition-all"
          :class="
            props.activeTypeFilters.has('manual')
              ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
              : 'bg-background/50 text-muted-foreground border-border/50 hover:bg-background/80'
          "
          @click="emit('toggle-type-filter', 'manual')"
        >
          {{ t("queue.filters.typeManual") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-xs rounded-md transition-all"
          :class="
            props.activeTypeFilters.has('batchCompress')
              ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
              : 'bg-background/50 text-muted-foreground border-border/50 hover:bg-background/80'
          "
          @click="emit('toggle-type-filter', 'batchCompress')"
        >
          {{ t("queue.filters.typeBatchCompress") }}
        </Button>
      </div>
    </div>

    <!-- 状态筛选 -->
    <div class="flex items-start gap-2">
      <span class="text-xs text-muted-foreground mt-1 min-w-[48px]">
        {{ t("queue.filters.statusLabel") }}
      </span>
      <div class="flex flex-wrap gap-1">
        <Button
          v-for="statusKey in statusOptions"
          :key="statusKey"
          type="button"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-xs rounded-md transition-all"
          :class="
            props.activeStatusFilters.has(statusKey)
              ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
              : 'bg-background/50 text-muted-foreground border-border/50 hover:bg-background/80'
          "
          @click="emit('toggle-status-filter', statusKey)"
        >
          {{ t(`queue.status.${statusKey}`) }}
        </Button>
      </div>
    </div>

    <!-- 文本筛选 -->
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground min-w-[48px]">
        {{ t("queue.filters.textLabel") }}
      </span>
      <div class="flex items-center gap-1 flex-1">
        <div class="relative max-w-xs flex-1">
          <Input
            :model-value="props.filterText"
            class="h-6 w-full text-xs px-2"
            :placeholder="textPlaceholder"
            data-testid="queue-filter-text-input"
            @focus="examplesOpen = true"
            @click="examplesOpen = true"
            @blur="closeExamples"
            @keydown.esc="closeExamples"
            @update:model-value="(v) => emit('update:filterText', String(v))"
          />
          <Transition name="fade">
            <div
              v-if="examplesOpen"
              class="absolute left-0 bottom-full mb-2 z-50 w-80 max-w-[min(20rem,100%)] rounded-md border bg-popover p-3 text-popover-foreground shadow-md pointer-events-none"
              data-testid="queue-filter-text-examples"
            >
              <div class="space-y-2">
                <div class="text-xs font-medium">{{ t("queue.filters.textExamplesTitle") }}</div>
                <div class="space-y-1">
                  <div
                    v-for="line in exampleLines"
                    :key="line"
                    class="text-xs font-mono rounded bg-muted/60 px-2 py-1 text-foreground"
                  >
                    {{ line }}
                  </div>
                </div>
                <p class="text-xs text-muted-foreground leading-snug">
                  {{ examplesHint }}
                </p>
              </div>
            </div>
          </Transition>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-xs font-mono"
          :class="
            props.filterUseRegex
              ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
              : 'bg-background/50 border-border/50 hover:bg-background/80'
          "
          :title="t('queue.filters.regexTooltip') || 'Use regular expression'"
          @click="emit('toggle-filter-regex-mode')"
        >
          /.*?/
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
          :title="t('queue.filters.reset')"
          @click="emit('reset-queue-filters')"
        >
          <RotateCcw class="h-3 w-3" />
          <span class="hidden sm:inline">{{ t("queue.filters.reset") }}</span>
        </Button>
      </div>
    </div>

    <!-- 错误消息 -->
    <Transition name="fade">
      <div v-if="props.filterRegexError" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground min-w-[48px]"></span>
        <p class="text-xs text-destructive flex items-center gap-1">
          <X class="h-3 w-3" />
          {{ props.filterRegexError }}
        </p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 动画过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
