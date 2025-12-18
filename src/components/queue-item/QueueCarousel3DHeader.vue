<script setup lang="ts">
import { Badge } from "@/components/ui/badge";
import { useI18n } from "vue-i18n";

defineProps<{
  totalItems: number;
  activeIndex: number;
  displayedLength: number;
}>();

const { t } = useI18n();
</script>

<template>
  <div data-testid="ffui-carousel-3d-header" class="flex items-center justify-between w-full mb-2 px-4 relative z-10">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-foreground">{{ t("app.tabs.queue") }}</span>
      <Badge variant="secondary" class="text-xs px-1.5 py-0">
        {{ totalItems }}
      </Badge>
    </div>
    <span class="text-xs text-muted-foreground font-mono"> {{ activeIndex + 1 }} / {{ displayedLength }} </span>
  </div>
</template>
