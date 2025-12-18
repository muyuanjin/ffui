<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";

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

const handleConfirm = () => {
  emit("confirm");
  emit("update:open", false);
};

const handleCancel = () => {
  emit("cancel");
  emit("update:open", false);
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("app.actions.deletePreset") }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ t("presetEditor.deleteConfirmMessage", { name: preset?.name || "" }) }}
        </DialogDescription>
      </DialogHeader>

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

      <DialogFooter class="gap-2">
        <Button variant="outline" size="sm" @click="handleCancel">
          {{ t("app.actions.cancel") }}
        </Button>
        <Button variant="destructive" size="sm" @click="handleConfirm">
          {{ t("app.actions.confirmDelete") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
