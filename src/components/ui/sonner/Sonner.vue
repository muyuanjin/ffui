<script lang="ts" setup>
import type { ToasterProps } from "vue-sonner";
import { reactiveOmit } from "@vueuse/core";
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, XIcon } from "lucide-vue-next";
import { Toaster as Sonner } from "vue-sonner";

const props = defineProps<ToasterProps>();
const delegatedProps = reactiveOmit(props, "toastOptions");
</script>

<template>
  <Sonner
    class="toaster group z-[10000] pointer-events-auto"
    :toast-options="{
      classes: {
        toast: 'group toast group-[.toaster]:shadow-lg group-[.toaster]:border group-[.toaster]:rounded-lg',
        description: 'group-[.toast]:opacity-90 whitespace-pre-line',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
