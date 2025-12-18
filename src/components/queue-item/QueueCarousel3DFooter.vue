<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  displayedLength: number;
  activeIndex: number;
}>();

const emit = defineEmits<{
  selectIndex: [index: number];
}>();

const { t } = useI18n();

const dotCount = computed(() => Math.min(props.displayedLength, 15));
const extraCount = computed(() => Math.max(0, props.displayedLength - 15));
</script>

<template>
  <div class="mt-auto w-full flex flex-col items-center relative z-10 pt-1">
    <div
      v-if="displayedLength > 1"
      data-testid="ffui-carousel-3d-pagination"
      class="flex justify-center items-center gap-1"
    >
      <button
        v-for="index in dotCount"
        :key="index"
        class="w-1.5 h-1.5 rounded-full transition-all"
        :class="index - 1 === activeIndex ? 'bg-primary w-3' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'"
        @click="emit('selectIndex', index - 1)"
      />
      <span v-if="extraCount > 0" class="text-[9px] text-muted-foreground/60 ml-1"> +{{ extraCount }} </span>
    </div>

    <p data-testid="ffui-carousel-3d-hint" class="text-center text-[10px] text-muted-foreground/60 mt-1">
      {{ t("queue.skippedStackHint") }}
    </p>
  </div>
</template>
