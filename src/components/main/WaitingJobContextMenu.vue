<template>
  <div
    v-if="visible"
    data-testid="waiting-job-context-menu"
    class="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-4"
  >
    <div class="rounded-md border border-border bg-popover shadow-lg px-3 py-2 flex gap-2">
      <button
        type="button"
        class="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
        @click="$emit('move-to-top')"
      >
        Move to top
      </button>
      <button
        type="button"
        class="text-xs px-2 py-1 rounded border border-border"
        @click="$emit('close')"
      >
        Close
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean }>();
defineEmits<{ (e: "move-to-top"): void; (e: "close"): void }>();
</script>
