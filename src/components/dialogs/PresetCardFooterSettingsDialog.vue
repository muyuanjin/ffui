<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PresetCardFooterItemKey, PresetCardFooterSettings } from "@/types";
import { useSortable } from "@vueuse/integrations/useSortable";
import { GripVertical } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
  footerSettings: Required<PresetCardFooterSettings>;
  onPatch: (patch: Partial<PresetCardFooterSettings>) => void;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
}>();

const { t } = useI18n();

const DEFAULT_ORDER: PresetCardFooterItemKey[] = ["avgSize", "fps", "vmaf", "usedCount", "dataAmount", "throughput"];

const normalizeOrder = (order: PresetCardFooterItemKey[] | undefined): PresetCardFooterItemKey[] => {
  const seen = new Set<PresetCardFooterItemKey>();
  const out: PresetCardFooterItemKey[] = [];
  const push = (k: PresetCardFooterItemKey) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const k of (Array.isArray(order) ? order : []) as PresetCardFooterItemKey[]) {
    if (!DEFAULT_ORDER.includes(k)) continue;
    push(k);
  }
  for (const k of DEFAULT_ORDER) push(k);
  return out;
};

const localOrder = ref<PresetCardFooterItemKey[]>(normalizeOrder(props.footerSettings.order));
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    localOrder.value = normalizeOrder(props.footerSettings.order);
  },
  { immediate: true },
);
watch(
  () => (props.footerSettings.order ?? []).join(","),
  () => {
    if (!props.open) return;
    localOrder.value = normalizeOrder(props.footerSettings.order);
  },
);

const orderedKeys = computed(() => localOrder.value);

const labelForKey = (k: PresetCardFooterItemKey): string => {
  switch (k) {
    case "avgSize":
      return t("app.settings.presetCardFooterItemAvgSize") as string;
    case "fps":
      return t("app.settings.presetCardFooterItemFps") as string;
    case "vmaf":
      return t("app.settings.presetCardFooterItemVmaf") as string;
    case "usedCount":
      return t("app.settings.presetCardFooterItemUsedCount") as string;
    case "dataAmount":
      return t("app.settings.presetCardFooterItemDataAmount") as string;
    case "throughput":
      return t("app.settings.presetCardFooterItemThroughput") as string;
  }
};

const isShown = (k: PresetCardFooterItemKey): boolean => {
  const s = props.footerSettings;
  switch (k) {
    case "avgSize":
      return !!s.showAvgSize;
    case "fps":
      return !!s.showFps;
    case "vmaf":
      return !!s.showVmaf;
    case "usedCount":
      return !!s.showUsedCount;
    case "dataAmount":
      return !!s.showDataAmount;
    case "throughput":
      return !!s.showThroughput;
  }
};

const setShown = (k: PresetCardFooterItemKey, v: boolean) => {
  switch (k) {
    case "avgSize":
      props.onPatch({ showAvgSize: v });
      return;
    case "fps":
      props.onPatch({ showFps: v });
      return;
    case "vmaf":
      props.onPatch({ showVmaf: v });
      return;
    case "usedCount":
      props.onPatch({ showUsedCount: v });
      return;
    case "dataAmount":
      props.onPatch({ showDataAmount: v });
      return;
    case "throughput":
      props.onPatch({ showThroughput: v });
      return;
  }
};

const listRef = ref<HTMLElement | null>(null);
const sortable = useSortable(listRef, localOrder, {
  animation: 150,
  handle: ".drag-handle",
  ghostClass: "opacity-30",
  chosenClass: "is-chosen",
  forceFallback: true,
  fallbackOnBody: true,
  fallbackClass: "drag-fallback",
  onEnd: async () => {
    if (!props.open) return;
    await nextTick();
    props.onPatch({ order: localOrder.value.slice() });
  },
});

watch(
  [() => props.open, () => listRef.value],
  async ([open, el]) => {
    if (!open) {
      sortable.stop();
      return;
    }
    if (!el) return;

    // DialogContent is mounted lazily/teleported; ensure Sortable starts only when
    // the list element is actually connected.
    const raf =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (cb: FrameRequestCallback) => globalThis.setTimeout(() => cb(Date.now()), 0);
    for (let i = 0; i < 10; i++) {
      await nextTick();
      await new Promise<void>((resolve) => raf(() => resolve()));
      if (listRef.value?.isConnected) break;
    }
    if (listRef.value?.isConnected) sortable.start();
  },
  { immediate: true, flush: "post" },
);

onBeforeUnmount(() => {
  sortable.stop();
});
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ t("app.settings.presetCardFooterDetailTitle") }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-2">
        <p class="text-[11px] text-muted-foreground leading-snug">
          {{ t("app.settings.presetCardFooterDetailDescription") }}
        </p>

        <div class="rounded border border-border/40 bg-muted/10 px-2 py-2">
          <div class="text-[11px] font-medium text-foreground mb-1.5">
            {{ t("app.settings.presetCardFooterDetailItemsTitle") }}
          </div>
          <p class="text-[10px] text-muted-foreground leading-snug mb-1">
            {{ t("app.settings.presetCardFooterDetailDragHint") }}
          </p>

          <div ref="listRef" class="space-y-1">
            <div
              v-for="k in orderedKeys"
              :key="k"
              class="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-accent/5"
            >
              <div class="drag-handle flex items-center gap-2 min-w-0 cursor-grab active:cursor-grabbing">
                <div
                  class="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
                  :title="t('app.settings.presetCardFooterDetailDragHint')"
                >
                  <GripVertical class="w-4 h-4" />
                </div>

                <span class="text-[11px] text-foreground truncate">{{ labelForKey(k) }}</span>
              </div>

              <Switch :model-value="isShown(k)" @update:model-value="(v) => setShown(k, !!v)" />
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="pt-2">
        <Button variant="outline" @click="emit('update:open', false)">{{ t("app.actions.close") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
