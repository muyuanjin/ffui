<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import ConfirmDialogShell from "./ConfirmDialogShell.vue";

defineProps<{
  open: boolean;
  presets: FFmpegPreset[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();
</script>

<template>
  <ConfirmDialogShell
    :open="open"
    :title="t('app.actions.deletePresetsConfirmTitle')"
    :description="t('app.actions.deletePresetsConfirmMessage', { count: presets.length })"
    :cancel-label="t('app.actions.cancel')"
    :confirm-label="t('app.actions.confirmDelete')"
    @update:open="emit('update:open', $event)"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <div v-if="presets.length > 0" class="py-4 space-y-2">
      <div class="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-xs">
        <p v-for="preset in presets.slice(0, 6)" :key="preset.id" class="truncate">
          {{ preset.name }}
        </p>
        <p v-if="presets.length > 6" class="text-muted-foreground">…</p>
      </div>
    </div>
  </ConfirmDialogShell>
</template>
