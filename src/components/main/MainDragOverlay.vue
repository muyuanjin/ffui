<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { MainAppTab } from "@/composables/main-app/useMainAppShell";

const props = defineProps<{
  activeTab: MainAppTab;
  isDragging: boolean;
}>();

const { t } = useI18n();

const title = computed(() =>
  props.activeTab === "media" ? t("media.dropTitle") : t("queue.dropTitle"),
);

const subtitle = computed(() =>
  props.activeTab === "media" ? t("media.dropSubtitle") : t("queue.dropSubtitle"),
);
</script>

<template>
  <div
    v-if="isDragging"
    class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-blue-900/80 backdrop-blur-md pointer-events-none"
  >
    <div
      class="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-blue-400/70 bg-blue-600/60 shadow-lg mb-4"
    >
      <span class="text-[10px] font-semibold tracking-[0.2em] uppercase text-blue-200">
        Drop
      </span>
    </div>
    <h2 class="text-2xl font-semibold text-white">
      {{ title }}
    </h2>
    <p class="mt-1 text-sm text-blue-200">
      {{ subtitle }}
    </p>
  </div>
</template>

