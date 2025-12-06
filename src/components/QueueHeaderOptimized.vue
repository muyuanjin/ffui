<template>
  <header
    data-testid="queue-secondary-header"
    class="shrink-0 border-b border-border bg-card/60 backdrop-blur"
  >
    <!-- 主要操作栏 -->
    <div class="px-3 py-1.5">
      <div class="flex items-center justify-between gap-4">
        <!-- 左侧：队列控制 -->
        <div class="flex items-center gap-3">
          <!-- 队列模式 -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-muted-foreground">队列模式</span>
            <button
              class="queue-select-button"
              title="仅改显示顺序：只改变界面上任务的展示顺序，不会影响后台实际执行顺序。拖拽、移到队首或队尾等调整优先级的操作在该模式下会被禁用。"
              role="combobox"
              type="button"
            >
              <span>视图排序</span>
              <svg class="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
          </div>

          <!-- 分隔线 -->
          <div class="h-4 w-px bg-border/60"></div>

          <!-- 排序控制 -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-muted-foreground">排序</span>
            <button class="queue-select-button">
              <span>按添加时间</span>
              <svg class="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>

            <button class="queue-action-button" data-testid="queue-sort-primary-direction-toggle">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m3 16 4 4 4-4"/>
                <path d="M7 20V4"/>
                <path d="m21 8-4-4-4 4"/>
                <path d="M17 4v16"/>
              </svg>
              <span>升序</span>
            </button>

            <button class="queue-action-button" data-testid="queue-secondary-sort-expand">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 13h18"/>
                <path d="M3 7h12"/>
                <path d="M3 19h6"/>
              </svg>
              <span>二级排序</span>
            </button>
          </div>
        </div>

        <!-- 右侧：筛选和统计 -->
        <div class="flex items-center gap-3">
          <!-- 统计信息 -->
          <span class="text-xs text-muted-foreground">
            显示 <span class="font-semibold text-foreground">2</span> / 2 个任务
          </span>

          <!-- 筛选按钮 -->
          <button class="queue-action-button group">
            <svg class="w-3 h-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
            </svg>
            <span>筛选</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 展开的筛选器区域（可选） -->
    <!-- <div class="border-t border-border/60 px-3 py-2" v-if="showFilters">
      筛选器内容
    </div> -->
  </header>
</template>

<style scoped>
/* 统一的按钮基础样式 */
.queue-action-button,
.queue-select-button {
  @apply inline-flex items-center gap-1 px-2 h-6 text-xs font-medium
    transition-all duration-150 rounded-md
    focus:outline-none focus:ring-1 focus:ring-ring/50;
}

/* 操作按钮样式 */
.queue-action-button {
  @apply text-muted-foreground hover:text-foreground
    hover:bg-accent/50 active:scale-95;
}

/* 选择器按钮样式 */
.queue-select-button {
  @apply min-w-[100px] justify-between
    bg-background/50 border border-border/50
    hover:bg-background/80 hover:border-border
    data-[state=open]:bg-accent data-[state=open]:text-accent-foreground;
}

/* 确保 SVG 图标大小一致 */
.queue-action-button svg,
.queue-select-button svg {
  @apply shrink-0;
}

/* 悬停效果增强 */
.queue-action-button:hover svg {
  @apply text-primary/80;
}

/* 激活状态 */
.queue-action-button[data-active="true"] {
  @apply bg-primary/10 text-primary;
}
</style>