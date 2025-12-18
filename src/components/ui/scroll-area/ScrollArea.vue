<script setup lang="ts">
import type { ScrollAreaRootProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from "reka-ui";
import { cn } from "@/lib/utils";
import ScrollBar from "./ScrollBar.vue";

const props = defineProps<ScrollAreaRootProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <ScrollAreaRoot v-bind="delegatedProps" :class="cn('relative overflow-hidden', props.class)">
    <ScrollAreaViewport class="ffui-scroll-area-viewport h-full w-full rounded-[inherit]">
      <slot />
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<style scoped>
/* Reka ScrollAreaViewport wraps slot content in an extra <div>. Give it a
   height context so descendants using `h-full` can actually fill the viewport,
   while keeping natural scroll height when content is taller. */
:deep(.ffui-scroll-area-viewport > div) {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
