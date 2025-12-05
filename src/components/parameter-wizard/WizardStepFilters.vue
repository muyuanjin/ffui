<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FilterConfig } from "@/types";

const { filters, isCopyEncoder, t } = defineProps<{
  filters: FilterConfig;
  isCopyEncoder: boolean;
  t: (key: string, params?: any) => string | unknown;
}>();

const emit = defineEmits<{
  (e: "update-filters", value: Partial<FilterConfig>): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div v-if="!isCopyEncoder" class="bg-muted/40 p-4 rounded-md border border-border/60">
      <h3 class="font-semibold mb-4 border-b border-border/60 pb-2">
        {{ t("presetEditor.filters.title") }}
      </h3>
      <div class="space-y-4">
        <div>
          <Label class="block text-sm mb-1">
            {{ t("presetEditor.filters.scaleLabel") }}
          </Label>
          <Input
            :placeholder="t('presetEditor.filters.scalePlaceholder')"
            :model-value="filters.scale ?? ''"
            @update:model-value="(value) => emit('update-filters', { scale: String(value ?? '') || undefined })"
          />
          <p class="text-xs text-muted-foreground mt-1">
            {{ t("presetEditor.filters.scaleHelp") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
