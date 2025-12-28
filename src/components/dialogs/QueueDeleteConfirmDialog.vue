<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const props = defineProps<{
  open: boolean;
  selectedCount: number;
  terminalCount: number;
  activeCount: number;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  cancel: [];
  "cancel-and-delete": [];
  "delete-terminal-only": [];
}>();

const { t } = useI18n();

const canDeleteTerminalOnly = computed(() => props.terminalCount > 0);

const handleCancel = () => {
  emit("cancel");
};

const handleCancelAndDelete = () => {
  emit("cancel-and-delete");
};

const handleDeleteTerminalOnly = () => {
  if (!canDeleteTerminalOnly.value) return;
  emit("delete-terminal-only");
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("queue.dialogs.deleteMixed.title") }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{
            t("queue.dialogs.deleteMixed.description", {
              selected: selectedCount,
              active: activeCount,
              terminal: terminalCount,
            })
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1">
        <p>
          <span class="text-muted-foreground">{{ t("queue.dialogs.deleteMixed.selected") }}:</span> {{ selectedCount }}
        </p>
        <p>
          <span class="text-muted-foreground">{{ t("queue.dialogs.deleteMixed.active") }}:</span> {{ activeCount }}
        </p>
        <p>
          <span class="text-muted-foreground">{{ t("queue.dialogs.deleteMixed.terminal") }}:</span> {{ terminalCount }}
        </p>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" size="sm" @click="handleCancel">
          {{ t("app.actions.cancel") }}
        </Button>
        <Button variant="success" size="sm" :disabled="!canDeleteTerminalOnly" @click="handleDeleteTerminalOnly">
          {{ t("queue.dialogs.deleteMixed.deleteTerminalOnly") }}
        </Button>
        <Button variant="destructive" size="sm" @click="handleCancelAndDelete">
          {{ t("queue.dialogs.deleteMixed.cancelAndDelete") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
