<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "vue-i18n";
import type { QueueFilterStatus, QueueFilterKind } from "@/composables";

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
</script>

<template>
  <div class="mt-2 space-y-3">
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
</template>

