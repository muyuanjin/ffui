<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { X } from "lucide-vue-next";
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits,
} from "reka-ui";
import { cn } from "@/lib/utils";

defineOptions({ inheritAttrs: false });

type Props = DialogContentProps & {
  class?: HTMLAttributes["class"];
  overlayClass?: HTMLAttributes["class"];
  overlayClosable?: boolean;
  hideClose?: boolean;
  portalDisabled?: boolean;
  portalForceMount?: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  overlayClosable: true,
  hideClose: false,
  portalDisabled: false,
  portalForceMount: false,
});
const emits = defineEmits<DialogContentEmits>();

const delegatedProps = reactiveOmit(
  props,
  "class",
  "overlayClass",
  "overlayClosable",
  "hideClose",
  "portalDisabled",
  "portalForceMount",
);

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const rootContext = injectDialogRootContext();

const handleOverlayPointerDown = (event: PointerEvent) => {
  if (!props.overlayClosable) return;
  const ctrlLeftClick = event.button === 0 && event.ctrlKey === true;
  const isRightClick = event.button === 2 || ctrlLeftClick;
  if (isRightClick) return;
  rootContext.onOpenChange(false);
};
</script>

<template>
  <DialogPortal :disabled="props.portalDisabled" :force-mount="props.portalForceMount">
    <DialogOverlay
      data-testid="dialog-overlay"
      :class="
        cn(
          'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          props.overlayClass,
        )
      "
      @pointerdown="handleOverlayPointerDown"
    />
    <DialogContent
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
          props.class,
        )
      "
    >
      <slot />

      <DialogClose
        v-if="!props.hideClose"
        class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
      >
        <X class="w-4 h-4" />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
