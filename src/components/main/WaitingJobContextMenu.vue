<template>
  <div v-if="visible" class="fixed inset-0 z-40" data-stop-clear-selection="true" @contextmenu.prevent>
    <DropdownMenu :open="visible" @update:open="onOpenChange">
      <DropdownMenuTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="fixed left-1/2 bottom-4 z-40 h-1 w-1 p-0 -translate-x-1/2 opacity-0"
          aria-hidden="true"
          data-testid="waiting-job-context-menu-anchor"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        class="z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-popover text-xs shadow-md py-1"
        side="top"
        align="center"
        :side-offset="8"
        :portal-disabled="true"
        :portal-force-mount="true"
        update-position-strategy="always"
        data-testid="waiting-job-context-menu"
      >
        <DropdownMenuItem class="px-3 py-1.5 text-xs gap-2" @select="$emit('move-to-top')">
          <ArrowUpToLine class="h-4 w-4 opacity-80 text-primary" aria-hidden="true" />
          Move to top
        </DropdownMenuItem>

        <DropdownMenuSeparator class="my-1 bg-border/40" />

        <DropdownMenuItem class="px-3 py-1.5 text-xs gap-2" @select="$emit('close')">
          <X class="h-4 w-4 opacity-80 text-muted-foreground" aria-hidden="true" />
          Close
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ArrowUpToLine, X } from "lucide-vue-next";

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "move-to-top"): void; (e: "close"): void }>();

const onOpenChange = (open: boolean) => {
  if (open) return;
  emit("close");
};
</script>
