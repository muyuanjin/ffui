<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

defineProps<{
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  contentClass?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  cancel: [];
}>();

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
    <DialogContent :class="['max-w-md', contentClass]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <slot />

      <DialogFooter class="gap-2">
        <Button variant="outline" size="sm" @click="handleCancel">
          {{ cancelLabel }}
        </Button>
        <Button variant="destructive" size="sm" @click="handleConfirm">
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
