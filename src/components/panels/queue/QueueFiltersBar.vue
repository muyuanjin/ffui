<script setup lang="ts">
import { ref, computed } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import type {
  QueueFilterStatus,
  QueueFilterKind,
  QueueSortField,
  QueueSortDirection,
} from "@/composables";
import type { QueueMode } from "@/types";

const props = defineProps<{
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
  sortPrimary: QueueSortField;
  sortPrimaryDirection: QueueSortDirection;
  sortSecondary: QueueSortField;
  sortSecondaryDirection: QueueSortDirection;
  hasActiveFilters: boolean;
  hasSelection: boolean;
  selectedCount: number;
  queueMode: QueueMode;
  visibleCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  (e: "toggle-status-filter", status: QueueFilterStatus): void;
  (e: "toggle-type-filter", kind: QueueFilterKind): void;
  (e: "update:filterText", value: string): void;
  (e: "toggle-filter-regex-mode"): void;
  (e: "reset-queue-filters"): void;
  (e: "update:sortPrimary", value: QueueSortField): void;
  (e: "update:sortPrimaryDirection", value: QueueSortDirection): void;
  (e: "update:sortSecondary", value: QueueSortField): void;
  (e: "update:sortSecondaryDirection", value: QueueSortDirection): void;
  (e: "select-all-visible-jobs"): void;
  (e: "invert-selection"): void;
  (e: "clear-selection"): void;
  (e: "bulk-cancel"): void;
  (e: "bulk-wait"): void;
  (e: "bulk-resume"): void;
  (e: "bulk-restart"): void;
  (e: "bulk-move-to-top"): void;
  (e: "bulk-move-to-bottom"): void;
  (e: "bulk-delete"): void;
}>();

const { t } = useI18n();

// Local UI state: whether the filter panel (tags + text input) is expanded.
const filterPanelOpen = ref(false);

const modeLabelShort = computed(() =>
  props.queueMode === "queue"
    ? t("queue.modes.queueLabelShort")
    : t("queue.modes.displayLabelShort"),
);

const modeHint = computed(() =>
  props.queueMode === "queue"
    ? t("queue.modes.queueHint")
    : t("queue.modes.displayHint"),
);
</script>

<template>
  <header
    data-testid="queue-secondary-header"
    class="shrink-0 border-b border-border bg-card/60 backdrop-blur px-4 py-2 space-y-2"
  >
    <!-- First row: mode indicator + primary/secondary sort controls -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold whitespace-nowrap">
            {{ t("queue.modeLabel") }}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px] rounded-full bg-card/80 border border-border/60 text-foreground"
            :title="String(modeHint)"
          >
            {{ modeLabelShort }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1">
            <span>{{ t("queue.sort.label") }}</span>
            <Select
              :model-value="props.sortPrimary"
              @update:model-value="(v) => emit('update:sortPrimary', v as QueueSortField)"
            >
              <SelectTrigger
                class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[130px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addedTime">
                  {{ t("queue.sort.fields.addedTime") }}
                </SelectItem>
                <SelectItem value="finishedTime">
                  {{ t("queue.sort.fields.finishedTime") }}
                </SelectItem>
                <SelectItem value="filename">
                  {{ t("queue.sort.fields.filename") }}
                </SelectItem>
                <SelectItem value="status">
                  {{ t("queue.sort.fields.status") }}
                </SelectItem>
                <SelectItem value="duration">
                  {{ t("queue.sort.fields.duration") }}
                </SelectItem>
                <SelectItem value="elapsed">
                  {{ t("queue.sort.fields.elapsed") }}
                </SelectItem>
                <SelectItem value="type">
                  {{ t("queue.sort.fields.type") }}
                </SelectItem>
                <SelectItem value="path">
                  {{ t("queue.sort.fields.path") }}
                </SelectItem>
                <SelectItem value="inputSize">
                  {{ t("queue.sort.fields.inputSize") }}
                </SelectItem>
                <SelectItem value="outputSize">
                  {{ t("queue.sort.fields.outputSize") }}
                </SelectItem>
                <SelectItem value="createdTime">
                  {{ t("queue.sort.fields.createdTime") }}
                </SelectItem>
                <SelectItem value="modifiedTime">
                  {{ t("queue.sort.fields.modifiedTime") }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="xs"
              class="h-7 px-2 text-[10px]"
              :class="
                props.sortPrimaryDirection === 'asc'
                  ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90'
                  : ''
              "
              @click="emit('update:sortPrimaryDirection', 'asc')"
            >
              {{ t("queue.sort.asc") }}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              class="h-7 px-2 text-[10px]"
              :class="
                props.sortPrimaryDirection === 'desc'
                  ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90'
                  : ''
              "
              @click="emit('update:sortPrimaryDirection', 'desc')"
            >
              {{ t("queue.sort.desc") }}
            </Button>
          </div>

          <div class="flex items-center gap-1">
            <span>{{ t("queue.sort.secondaryLabel") }}</span>
            <Select
              :model-value="props.sortSecondary"
              @update:model-value="(v) => emit('update:sortSecondary', v as QueueSortField)"
            >
              <SelectTrigger
                class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[130px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="filename">
                  {{ t("queue.sort.fields.filename") }}
                </SelectItem>
                <SelectItem value="status">
                  {{ t("queue.sort.fields.status") }}
                </SelectItem>
                <SelectItem value="addedTime">
                  {{ t("queue.sort.fields.addedTime") }}
                </SelectItem>
                <SelectItem value="finishedTime">
                  {{ t("queue.sort.fields.finishedTime") }}
                </SelectItem>
                <SelectItem value="duration">
                  {{ t("queue.sort.fields.duration") }}
                </SelectItem>
                <SelectItem value="elapsed">
                  {{ t("queue.sort.fields.elapsed") }}
                </SelectItem>
                <SelectItem value="type">
                  {{ t("queue.sort.fields.type") }}
                </SelectItem>
                <SelectItem value="path">
                  {{ t("queue.sort.fields.path") }}
                </SelectItem>
                <SelectItem value="inputSize">
                  {{ t("queue.sort.fields.inputSize") }}
                </SelectItem>
                <SelectItem value="outputSize">
                  {{ t("queue.sort.fields.outputSize") }}
                </SelectItem>
                <SelectItem value="createdTime">
                  {{ t("queue.sort.fields.createdTime") }}
                </SelectItem>
                <SelectItem value="modifiedTime">
                  {{ t("queue.sort.fields.modifiedTime") }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="xs"
              class="h-7 px-2 text-[10px]"
              :class="
                props.sortSecondaryDirection === 'asc'
                  ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90'
                  : ''
              "
              @click="emit('update:sortSecondaryDirection', 'asc')"
            >
              {{ t("queue.sort.asc") }}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              class="h-7 px-2 text-[10px]"
              :class="
                props.sortSecondaryDirection === 'desc'
                  ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90'
                  : ''
              "
              @click="emit('update:sortSecondaryDirection', 'desc')"
            >
              {{ t("queue.sort.desc") }}
            </Button>
          </div>
        </div>
      </div>

      <p
        class="hidden md:block max-w-xl text-[11px] text-muted-foreground"
        :title="String(modeHint)"
      >
        {{ modeHint }}
      </p>
    </div>

    <!-- Second row: selection summary, filter summary + toggle, bulk actions -->
    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-2">
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {{
            t("queue.filters.summary", {
              visible: props.visibleCount,
              total: props.totalCount,
            })
          }}
        </span>
        <span
          v-if="props.hasActiveFilters"
          class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
        >
          {{ t("queue.filters.activeBadge") }}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="h-6 px-2 text-[10px]"
          @click="filterPanelOpen = !filterPanelOpen"
        >
          {{
            filterPanelOpen
              ? t("queue.filters.collapse")
              : t("queue.filters.expand")
          }}
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div
          v-if="props.hasSelection"
          class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
        >
          <span>
            {{
              t("queue.selection.selectedCount", {
                count: props.selectedCount,
              })
            }}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-6 px-2 text-[10px]"
            @click="emit('select-all-visible-jobs')"
          >
            {{ t("queue.selection.selectAll") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-6 px-2 text-[10px]"
            @click="emit('invert-selection')"
          >
            {{ t("queue.selection.invert") }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-6 px-2 text-[10px]"
            @click="emit('clear-selection')"
          >
            {{ t("queue.selection.clear") }}
          </Button>
        </div>

        <div
          v-if="props.hasSelection"
          class="flex flex-wrap items-center gap-1"
        >
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            @click="emit('bulk-cancel')"
          >
            {{ t("queue.actions.bulkCancel") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :disabled="props.queueMode !== 'queue'"
            @click="emit('bulk-wait')"
          >
            {{ t("queue.actions.bulkWait") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :disabled="props.queueMode !== 'queue'"
            @click="emit('bulk-resume')"
          >
            {{ t("queue.actions.bulkResume") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :disabled="props.queueMode !== 'queue'"
            @click="emit('bulk-restart')"
          >
            {{ t("queue.actions.bulkRestart") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :disabled="props.queueMode !== 'queue'"
            @click="emit('bulk-move-to-top')"
          >
            {{ t("queue.actions.bulkMoveToTop") }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :disabled="props.queueMode !== 'queue'"
            @click="emit('bulk-move-to-bottom')"
          >
            {{ t("queue.actions.bulkMoveToBottom") }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-7 px-2 text-[10px]"
            @click="emit('bulk-delete')"
          >
            {{ t("queue.actions.bulkDelete") }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Collapsible filter panel (type/status tags + unified text filter) -->
    <div v-if="filterPanelOpen" class="mt-2 space-y-3">
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span class="whitespace-nowrap">
          {{ t("queue.filters.typeLabel") }}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          class="h-7 px-2 text-[11px] rounded-full border-border/60 transition-colors"
          :class="
            props.activeTypeFilters.has('manual')
              ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90 hover:text-primary-foreground'
              : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
          "
          @click="emit('toggle-type-filter', 'manual')"
        >
          {{ t("queue.filters.typeManual") }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          class="h-7 px-2 text-[11px] rounded-full border-border/60 transition-colors"
          :class="
            props.activeTypeFilters.has('smartScan')
              ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90 hover:text-primary-foreground'
              : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
          "
          @click="emit('toggle-type-filter', 'smartScan')"
        >
          {{ t("queue.filters.typeSmartScan") }}
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span class="whitespace-nowrap">
          {{ t("queue.filters.statusLabel") }}
        </span>
        <Button
          v-for="statusKey in [
            'processing',
            'waiting',
            'queued',
            'paused',
            'completed',
            'failed',
            'cancelled',
            'skipped',
          ]"
          :key="statusKey"
          type="button"
          variant="outline"
          size="xs"
          class="h-7 px-2 text-[11px] rounded-full border-border/60 transition-colors"
          :class="
            props.activeStatusFilters.has(statusKey as any)
              ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90 hover:text-primary-foreground'
              : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
          "
          @click="emit('toggle-status-filter', statusKey as QueueFilterStatus)"
        >
          {{ t(`queue.status.${statusKey}`) }}
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span class="whitespace-nowrap">
          {{ t("queue.filters.textLabel") }}
        </span>
        <Input
          :model-value="props.filterText"
          class="h-8 w-64 text-xs"
          :placeholder="t('queue.filters.textPlaceholder')"
          @update:model-value="(v) => emit('update:filterText', String(v))"
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          class="h-7 px-2 text-[10px]"
          :class="
            props.filterUseRegex
              ? 'bg-primary text-primary-foreground border-primary/60 hover:bg-primary/90 hover:text-primary-foreground'
              : ''
          "
          :title="t('queue.filters.textPlaceholder') as string"
          @click="emit('toggle-filter-regex-mode')"
        >
          /regex/
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="h-7 px-2 text-[10px]"
          @click="emit('reset-queue-filters')"
        >
          {{ t("queue.filters.reset") }}
        </Button>
        <p
          v-if="props.filterRegexError"
          class="text-[11px] text-destructive"
        >
          {{ props.filterRegexError }}
        </p>
      </div>
    </div>
  </header>
</template>
