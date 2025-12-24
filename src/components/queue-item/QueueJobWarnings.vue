<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle } from "lucide-vue-next";
import type { JobWarning } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  warnings?: JobWarning[];
}>();

const warnings = computed(() => props.warnings ?? []);
const hasWarnings = computed(() => warnings.value.length > 0);

const { t } = useI18n();
</script>

<template>
  <TooltipProvider v-if="hasWarnings">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="h-5 w-5 rounded-md text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
          :aria-label="t('queue.warnings.ariaLabel')"
          @click.stop
          @mousedown.stop
        >
          <AlertTriangle class="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-[320px] border-amber-500/40 bg-amber-500/10 text-amber-50">
        <div class="space-y-1">
          <p class="font-semibold text-amber-100">{{ t("queue.warnings.title") }}</p>
          <ul class="space-y-1">
            <li v-for="w in warnings" :key="w.code" class="text-[11px] leading-snug">
              {{ w.message }}
            </li>
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
