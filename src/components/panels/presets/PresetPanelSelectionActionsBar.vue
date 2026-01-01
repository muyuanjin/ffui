<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Download, Pin, PinOff, Trash2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = defineProps<{
  show: boolean;
  selectedCount: number;
  pinned: boolean;
}>();

const emit = defineEmits<{
  batchExport: [];
  batchDelete: [];
  clearSelection: [];
  togglePinned: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="props.show"
    class="border-b border-border/60 px-3 py-1.5 bg-accent/5 text-xs"
    data-testid="preset-selection-actions"
  >
    <div class="flex items-center justify-between gap-2 min-w-max">
      <div class="text-muted-foreground">{{ t("presets.selectedCount", { count: props.selectedCount }) }}</div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          data-testid="preset-batch-export"
          :disabled="props.selectedCount === 0"
          @click="emit('batchExport')"
        >
          <Download class="h-3 w-3 mr-1" />
          {{ t("presets.export") }}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          class="h-7 px-2 text-[11px]"
          data-testid="preset-batch-delete"
          :disabled="props.selectedCount === 0"
          @click="emit('batchDelete')"
        >
          <Trash2 class="h-3 w-3 mr-1" />
          {{ t("presets.batchDelete") }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="props.selectedCount === 0"
          @click="emit('clearSelection')"
        >
          {{ t("presets.clearSelection") }}
        </Button>

        <slot name="right" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          data-testid="preset-selection-pin"
          :class="props.pinned ? 'text-primary' : undefined"
          :title="props.pinned ? t('presets.unpinSelectionBar') : t('presets.pinSelectionBar')"
          :aria-label="props.pinned ? t('presets.unpinSelectionBar') : t('presets.pinSelectionBar')"
          @click="emit('togglePinned')"
        >
          <PinOff v-if="props.pinned" class="h-3 w-3 text-primary" />
          <Pin v-else class="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    </div>
  </div>
</template>
