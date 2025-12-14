<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle } from "lucide-vue-next";
import type { JobWarning } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const props = defineProps<{
  warnings?: JobWarning[];
}>();

const normalizedWarnings = computed(() => (props.warnings ?? []).filter(Boolean));
const hasWarnings = computed(() => normalizedWarnings.value.length > 0);
</script>

<template>
  <TooltipProvider v-if="hasWarnings">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex items-center justify-center h-5 w-5 rounded-md text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
          aria-label="Warnings"
          @click.stop
          @mousedown.stop
        >
          <AlertTriangle class="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent class="max-w-[320px] border-amber-500/40 bg-amber-500/10 text-amber-50">
        <div class="space-y-1">
          <p class="font-semibold text-amber-100">输出警告</p>
          <ul class="space-y-1">
            <li v-for="w in normalizedWarnings" :key="w.code" class="text-[11px] leading-snug">
              {{ w.message }}
            </li>
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

