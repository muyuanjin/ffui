<script setup lang="ts">
import type { HoverCardRootProps } from "reka-ui";
import { HoverCardRoot, useForwardPropsEmits } from "reka-ui";

const props = defineProps<HoverCardRootProps>();
const emits = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <HoverCardRoot v-bind="forwarded">
    <slot />
  </HoverCardRoot>
</template>
