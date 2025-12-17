<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-vue-next";

const props = defineProps<{
  rawCommand: string;
  mediaSummary: string;
  hasDistinctTemplate: boolean;
  commandTitle: string;
  copyTitle: string;
  toggleLabel: string;
  highlightedHtml: string;
}>();

const emit = defineEmits<{
  (e: "copy"): void;
  (e: "toggle"): void;
}>();
</script>

<template>
  <div class="mt-2 space-y-1">
    <div class="flex items-center justify-between text-[11px] text-muted-foreground">
      <div class="flex items-center gap-2 min-w-0">
        <span class="flex-shrink-0">{{ props.commandTitle }}</span>
        <span
          v-if="props.mediaSummary"
          class="inline-flex items-center rounded bg-muted px-1.5 py-0.5"
        >
          {{ props.mediaSummary }}
        </span>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <Button
          v-if="props.rawCommand"
          type="button"
          variant="ghost"
          size="icon-xs"
          class="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/60"
          data-testid="queue-item-copy-command"
          :title="props.copyTitle"
          @click.stop="emit('copy')"
        >
          <Copy class="h-3.5 w-3.5" :stroke-width="2" />
          <span class="sr-only">{{ props.copyTitle }}</span>
        </Button>
        <Button
          v-if="props.hasDistinctTemplate"
          type="button"
          variant="link"
          size="xs"
          class="text-[10px] px-0"
          @click.stop="emit('toggle')"
        >
          {{ props.toggleLabel }}
        </Button>
      </div>
    </div>
    <pre
      class="max-h-24 overflow-y-auto rounded-md bg-muted/40 border border-border/60 px-2 py-1 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap select-text"
      v-html="props.highlightedHtml"
    />
  </div>
</template>

