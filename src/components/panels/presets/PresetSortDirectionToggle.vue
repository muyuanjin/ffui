<script setup lang="ts">
import { Button } from "@/components/ui/button";
import type { PresetSortDirection } from "@/types";
import { ArrowDownUp, ArrowUpDown } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  direction: PresetSortDirection;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Button
    variant="outline"
    size="sm"
    class="h-7 w-7 p-0"
    data-testid="preset-sort-direction-toggle"
    :disabled="props.disabled"
    :title="props.direction === 'asc' ? t('presets.sortAsc') : t('presets.sortDesc')"
    @click="emit('toggle')"
  >
    <ArrowUpDown v-if="props.direction === 'asc'" class="w-3.5 h-3.5" />
    <ArrowDownUp v-else class="w-3.5 h-3.5" />
  </Button>
</template>
