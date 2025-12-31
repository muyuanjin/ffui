<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    text: string;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    contentClass?: string;
  }>(),
  {
    side: "top",
    sideOffset: 6,
    contentClass: "max-w-[360px] text-[10px] leading-snug",
  },
);
</script>

<template>
  <TooltipProvider :delay-duration="120">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
          :title="props.text"
          :aria-label="props.text"
          data-no-select-toggle
          @click.stop
          @mousedown.stop
        >
          <CircleHelp class="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent :side="props.side" :side-offset="props.sideOffset" :class="props.contentClass">
        {{ props.text }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
