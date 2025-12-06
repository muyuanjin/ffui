<template>
  <header
    data-testid="queue-secondary-header"
    class="queue-header"
  >
    <!-- 主要操作栏 -->
    <div class="queue-header__main">
      <div class="queue-header__controls">
        <!-- 左侧：队列控制 -->
        <div class="queue-header__group">
          <!-- 队列模式 -->
          <div class="queue-header__item">
            <label class="queue-header__label">队列模式</label>
            <Select v-model="queueMode" class="queue-header__select">
              <SelectTrigger class="queue-header__select-trigger">
                <SelectValue>{{ queueModeText }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">视图排序</SelectItem>
                <SelectItem value="priority">优先级排序</SelectItem>
                <SelectItem value="manual">手动排序</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="queue-header__divider" />

          <!-- 排序控制 -->
          <div class="queue-header__item">
            <label class="queue-header__label">排序</label>

            <Select v-model="sortBy" class="queue-header__select">
              <SelectTrigger class="queue-header__select-trigger">
                <SelectValue>{{ sortByText }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addedTime">按添加时间</SelectItem>
                <SelectItem value="fileName">按文件名</SelectItem>
                <SelectItem value="fileSize">按文件大小</SelectItem>
                <SelectItem value="duration">按时长</SelectItem>
                <SelectItem value="status">按状态</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="icon-xs"
              class="queue-header__icon-btn"
              @click="toggleSortDirection"
              :title="sortDirection === 'asc' ? '升序' : '降序'"
            >
              <ArrowUpDown v-if="sortDirection === 'asc'" class="w-3 h-3" />
              <ArrowDownUp v-else class="w-3 h-3" />
              <span class="queue-header__btn-text">{{ sortDirection === 'asc' ? '升序' : '降序' }}</span>
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              class="queue-header__icon-btn"
              @click="showSecondarySort = !showSecondarySort"
            >
              <ListOrdered class="w-3 h-3" />
              <span class="queue-header__btn-text">二级排序</span>
            </Button>
          </div>
        </div>

        <!-- 右侧：筛选和统计 -->
        <div class="queue-header__group">
          <!-- 统计信息 -->
          <div class="queue-header__stats">
            显示
            <span class="queue-header__stats-highlight">{{ filteredCount }}</span>
            / {{ totalCount }} 个任务
          </div>

          <!-- 筛选按钮 -->
          <Button
            variant="ghost"
            size="icon-xs"
            class="queue-header__icon-btn"
            @click="showFilters = !showFilters"
            :data-active="showFilters"
          >
            <Filter class="w-3 h-3" />
            <span class="queue-header__btn-text">筛选</span>
            <Badge v-if="activeFilterCount > 0" class="queue-header__badge">
              {{ activeFilterCount }}
            </Badge>
          </Button>
        </div>
      </div>
    </div>

    <!-- 二级排序面板 -->
    <Transition name="slide">
      <div v-if="showSecondarySort" class="queue-header__panel">
        <div class="queue-header__panel-content">
          <span class="queue-header__label">二级排序</span>
          <Select v-model="secondarySortBy" class="queue-header__select queue-header__select--small">
            <SelectTrigger class="queue-header__select-trigger">
              <SelectValue>{{ secondarySortByText || '无' }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">无</SelectItem>
              <SelectItem value="fileName">按文件名</SelectItem>
              <SelectItem value="fileSize">按文件大小</SelectItem>
              <SelectItem value="duration">按时长</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Transition>

    <!-- 筛选器面板 -->
    <Transition name="slide">
      <div v-if="showFilters" class="queue-header__panel">
        <div class="queue-header__filters">
          <!-- 状态筛选 -->
          <div class="queue-header__filter-group">
            <span class="queue-header__label">状态</span>
            <div class="queue-header__filter-chips">
              <Chip
                v-for="status in statusOptions"
                :key="status.value"
                :selected="filters.status.includes(status.value)"
                @click="toggleFilter('status', status.value)"
              >
                {{ status.label }}
              </Chip>
            </div>
          </div>

          <!-- 编码器筛选 -->
          <div class="queue-header__filter-group">
            <span class="queue-header__label">编码器</span>
            <div class="queue-header__filter-chips">
              <Chip
                v-for="encoder in encoderOptions"
                :key="encoder.value"
                :selected="filters.encoder.includes(encoder.value)"
                @click="toggleFilter('encoder', encoder.value)"
              >
                {{ encoder.label }}
              </Chip>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown, ArrowDownUp, Filter, ListOrdered } from 'lucide-vue-next'

// Props
interface Props {
  totalCount?: number
  filteredCount?: number
}

withDefaults(defineProps<Props>(), {
  totalCount: 0,
  filteredCount: 0
})

// State
const queueMode = ref('view')
const sortBy = ref('addedTime')
const sortDirection = ref<'asc' | 'desc'>('asc')
const secondarySortBy = ref('')
const showSecondarySort = ref(false)
const showFilters = ref(false)

const filters = ref({
  status: [] as string[],
  encoder: [] as string[]
})

// Options
const statusOptions = [
  { value: 'pending', label: '等待中' },
  { value: 'running', label: '运行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' }
]

const encoderOptions = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265' },
  { value: 'av1', label: 'AV1' },
  { value: 'vp9', label: 'VP9' }
]

// Computed
const queueModeText = computed(() => {
  const modes: Record<string, string> = {
    view: '视图排序',
    priority: '优先级排序',
    manual: '手动排序'
  }
  return modes[queueMode.value] || '视图排序'
})

const sortByText = computed(() => {
  const sorts: Record<string, string> = {
    addedTime: '按添加时间',
    fileName: '按文件名',
    fileSize: '按文件大小',
    duration: '按时长',
    status: '按状态'
  }
  return sorts[sortBy.value] || '按添加时间'
})

const secondarySortByText = computed(() => {
  const sorts: Record<string, string> = {
    fileName: '按文件名',
    fileSize: '按文件大小',
    duration: '按时长'
  }
  return sorts[secondarySortBy.value] || ''
})

const activeFilterCount = computed(() => {
  return filters.value.status.length + filters.value.encoder.length
})

// Methods
const toggleSortDirection = () => {
  sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
}

const toggleFilter = (type: 'status' | 'encoder', value: string) => {
  const index = filters.value[type].indexOf(value)
  if (index > -1) {
    filters.value[type].splice(index, 1)
  } else {
    filters.value[type].push(value)
  }
}

// Chip component (可以提取为独立组件)
const Chip = {
  props: ['selected'],
  template: `
    <button
      class="queue-header__chip"
      :class="{ 'queue-header__chip--selected': selected }"
      @click="$emit('click')"
    >
      <slot />
    </button>
  `
}
</script>

<style scoped>
.queue-header {
  @apply shrink-0 border-b border-border bg-card/60 backdrop-blur;
}

/* 主要区域 */
.queue-header__main {
  @apply px-3 py-1.5;
}

.queue-header__controls {
  @apply flex items-center justify-between gap-4;
}

.queue-header__group {
  @apply flex items-center gap-3;
}

.queue-header__item {
  @apply flex items-center gap-1.5;
}

/* 标签 */
.queue-header__label {
  @apply text-xs text-muted-foreground whitespace-nowrap;
}

/* 分隔线 */
.queue-header__divider {
  @apply h-4 w-px bg-border/60;
}

/* 选择器 */
.queue-header__select {
  @apply h-6;
}

.queue-header__select-trigger {
  @apply h-6 min-w-[100px] px-2 text-xs
    bg-background/50 border-border/50
    hover:bg-background/80 hover:border-border
    focus:ring-1 focus:ring-ring/50;
}

.queue-header__select--small .queue-header__select-trigger {
  @apply min-w-[80px];
}

/* 图标按钮 */
.queue-header__icon-btn {
  @apply h-6 px-2 gap-1 text-xs text-muted-foreground
    hover:text-foreground hover:bg-accent/50
    transition-all duration-150
    data-[active=true]:bg-primary/10 data-[active=true]:text-primary;
}

.queue-header__btn-text {
  @apply hidden sm:inline;
}

/* 统计信息 */
.queue-header__stats {
  @apply text-xs text-muted-foreground;
}

.queue-header__stats-highlight {
  @apply font-semibold text-foreground;
}

/* 徽章 */
.queue-header__badge {
  @apply ml-1 h-4 px-1 text-[10px] bg-primary/20 text-primary;
}

/* 面板 */
.queue-header__panel {
  @apply border-t border-border/60 px-3 py-2;
}

.queue-header__panel-content {
  @apply flex items-center gap-2;
}

/* 筛选器 */
.queue-header__filters {
  @apply space-y-2;
}

.queue-header__filter-group {
  @apply flex items-center gap-2;
}

.queue-header__filter-chips {
  @apply flex flex-wrap gap-1;
}

.queue-header__chip {
  @apply h-5 px-2 text-[11px] rounded-full
    bg-background/50 border border-border/30
    text-muted-foreground
    hover:bg-background/80 hover:border-border/50
    transition-all duration-150;
}

.queue-header__chip--selected {
  @apply bg-primary/20 border-primary/50 text-primary
    hover:bg-primary/30 hover:border-primary/60;
}

/* 动画 */
.slide-enter-active,
.slide-leave-active {
  @apply transition-all duration-200 ease-out;
}

.slide-enter-from {
  @apply opacity-0 -translate-y-2;
}

.slide-leave-to {
  @apply opacity-0 -translate-y-1;
}

/* 响应式优化 */
@media (max-width: 640px) {
  .queue-header__main {
    @apply px-2 py-1;
  }

  .queue-header__controls {
    @apply gap-2;
  }

  .queue-header__group {
    @apply gap-2;
  }

  .queue-header__select-trigger {
    @apply min-w-[80px];
  }
}
</style>
