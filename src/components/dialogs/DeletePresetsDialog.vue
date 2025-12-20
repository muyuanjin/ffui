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
  open: boolean;
  presets: FFmpegPreset[];
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
        <DialogTitle>{{ t("app.actions.deletePresetsConfirmTitle") }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ t("app.actions.deletePresetsConfirmMessage", { count: presets.length }) }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="presets.length > 0" class="py-4 space-y-2">
        <div class="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1 text-xs">
          <p v-for="preset in presets.slice(0, 6)" :key="preset.id" class="truncate">
            {{ preset.name }}
          </p>
          <p v-if="presets.length > 6" class="text-muted-foreground">…</p>
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
