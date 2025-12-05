<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import type {
  QueueFilterStatus,
  QueueFilterKind,
  QueueSortField,
  QueueSortDirection,
} from "@/composables";
import type { QueueMode } from "@/types";

const {
  activeStatusFilters,
  activeTypeFilters,
  filterText,
  filterUseRegex,
  filterRegexError,
  sortPrimary,
  sortPrimaryDirection,
  hasSelection,
  selectedCount,
  queueMode,
} = defineProps<{
  activeStatusFilters: Set<QueueFilterStatus>;
  activeTypeFilters: Set<QueueFilterKind>;
  filterText: string;
  filterUseRegex: boolean;
  filterRegexError: string | null;
  sortPrimary: QueueSortField;
  sortPrimaryDirection: QueueSortDirection;
  hasSelection: boolean;
  selectedCount: number;
  queueMode: QueueMode;
}>();

const emit = defineEmits<{
  (e: "toggle-status-filter", status: QueueFilterStatus): void;
  (e: "toggle-type-filter", kind: QueueFilterKind): void;
  (e: "update:filterText", value: string): void;
  (e: "toggle-filter-regex-mode"): void;
  (e: "reset-queue-filters"): void;
  (e: "update:sortPrimary", value: QueueSortField): void;
  (e: "update:sortPrimaryDirection", value: QueueSortDirection): void;
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
</script>

<template>
  <div data-testid="queue-secondary-header" class="mb-3 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span class="font-semibold">{{ t("queue.filters.label") }}</span>
        <div class="flex flex-wrap items-center gap-1">
          <Button
            v-for="statusKey in ['processing','waiting','queued','paused','completed','failed','cancelled','skipped']"
            :key="statusKey"
            variant="outline"
            size="xs"
            class="h-6 px-2 text-[10px]"
            :class="activeStatusFilters.has(statusKey as any) ? 'bg-primary text-primary-foreground border-primary/60' : ''"
            @click="emit('toggle-status-filter', statusKey as QueueFilterStatus)"
          >
            {{ t(`queue.status.${statusKey}`) }}
          </Button>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('select-all-visible-jobs')">
          {{ t("queue.selection.selectAll") }}
        </Button>
        <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('invert-selection')">
          {{ t("queue.selection.invert") }}
        </Button>
        <Button variant="ghost" size="xs" class="h-6 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('clear-selection')">
          {{ t("queue.selection.clear") }}
        </Button>
        <span v-if="hasSelection" class="text-[11px] text-muted-foreground">
          {{ t("queue.selection.selectedCount", { count: selectedCount }) }}
        </span>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] text-muted-foreground">{{ t("queue.filters.typeLabel") }}</span>
        <Button
          variant="outline"
          size="xs"
          class="h-6 px-2 text-[10px]"
          :class="activeTypeFilters.has('manual') ? 'bg-primary text-primary-foreground border-primary/60' : ''"
          @click="emit('toggle-type-filter', 'manual')"
        >
          {{ t("queue.filters.typeManual") }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="h-6 px-2 text-[10px]"
          :class="activeTypeFilters.has('smartScan') ? 'bg-primary text-primary-foreground border-primary/60' : ''"
          @click="emit('toggle-type-filter', 'smartScan')"
        >
          {{ t("queue.filters.typeSmartScan") }}
        </Button>

        <Input
          :model-value="filterText"
          class="h-7 w-48 text-xs"
          :placeholder="t('queue.filters.textPlaceholder')"
          @update:model-value="(v) => emit('update:filterText', String(v))"
        />
        <Button
          variant="outline"
          size="xs"
          class="h-7 px-2 text-[10px]"
          :class="filterUseRegex ? 'bg-primary text-primary-foreground border-primary/60' : ''"
          @click="emit('toggle-filter-regex-mode')"
        >
          /regex/
        </Button>
        <Button variant="ghost" size="xs" class="h-7 px-2 text-[10px]" @click="emit('reset-queue-filters')">
          {{ t("queue.filters.reset") }}
        </Button>
        <p v-if="filterRegexError" class="text-[11px] text-destructive">{{ filterRegexError }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{{ t("queue.sort.label") }}</span>
          <Select :model-value="sortPrimary" @update:model-value="(v) => emit('update:sortPrimary', v as QueueSortField)">
            <SelectTrigger class="h-7 px-2 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground min-w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="addedTime">{{ t("queue.sort.fields.addedTime") }}</SelectItem>
              <SelectItem value="finishedTime">{{ t("queue.sort.fields.finishedTime") }}</SelectItem>
              <SelectItem value="filename">{{ t("queue.sort.fields.filename") }}</SelectItem>
              <SelectItem value="status">{{ t("queue.sort.fields.status") }}</SelectItem>
              <SelectItem value="progress">{{ t("queue.sort.fields.progress") }}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :class="sortPrimaryDirection === 'asc' ? 'bg-primary text-primary-foreground border-primary/60' : ''"
            @click="emit('update:sortPrimaryDirection', 'asc')"
          >
            {{ t("queue.sort.asc") }}
          </Button>
          <Button
            variant="outline"
            size="xs"
            class="h-7 px-2 text-[10px]"
            :class="sortPrimaryDirection === 'desc' ? 'bg-primary text-primary-foreground border-primary/60' : ''"
            @click="emit('update:sortPrimaryDirection', 'desc')"
          >
            {{ t("queue.sort.desc") }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('bulk-cancel')">
            {{ t("queue.actions.bulkCancel") }}
          </Button>
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulk-wait')">
            {{ t("queue.actions.bulkWait") }}
          </Button>
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulk-resume')">
            {{ t("queue.actions.bulkResume") }}
          </Button>
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulk-restart')">
            {{ t("queue.actions.bulkRestart") }}
          </Button>
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulk-move-to-top')">
            {{ t("queue.actions.bulkMoveToTop") }}
          </Button>
          <Button variant="outline" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection || queueMode !== 'queue'" @click="emit('bulk-move-to-bottom')">
            {{ t("queue.actions.bulkMoveToBottom") }}
          </Button>
          <Button variant="ghost" size="xs" class="h-7 px-2 text-[10px]" :disabled="!hasSelection" @click="emit('bulk-delete')">
            {{ t("queue.actions.bulkDelete") }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
