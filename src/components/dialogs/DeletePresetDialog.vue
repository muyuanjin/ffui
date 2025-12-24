<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import ConfirmDialogShell from "./ConfirmDialogShell.vue";

defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The preset pending deletion */
  preset: FFmpegPreset | null;
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
    :title="t('app.actions.deletePreset')"
    :description="t('presetEditor.deleteConfirmMessage', { name: preset?.name || '' })"
    :cancel-label="t('app.actions.cancel')"
    :confirm-label="t('app.actions.confirmDelete')"
    @update:open="emit('update:open', $event)"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <div v-if="preset" class="py-4">
      <div class="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-xs">
        <p>
          <span class="text-muted-foreground">{{ t("presetEditor.nameLabel") }}:</span> {{ preset.name }}
        </p>
        <p v-if="preset.description">
          <span class="text-muted-foreground">{{ t("presetEditor.descriptionLabel") }}:</span>
          {{ preset.description }}
        </p>
        <p>
          <span class="text-muted-foreground">{{ t("presets.usedTimes", { count: preset.stats.usageCount }) }}</span>
        </p>
      </div>
    </div>
  </ConfirmDialogShell>
</template>
