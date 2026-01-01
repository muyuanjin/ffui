<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { PresetCardFooterItemKey, PresetCardFooterSettings } from "@/types";
import { ArrowDown, ArrowUp } from "lucide-vue-next";

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

const orderedKeys = computed(() => normalizeOrder(props.footerSettings.order));

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

const move = (k: PresetCardFooterItemKey, delta: -1 | 1) => {
  const keys = orderedKeys.value.slice();
  const idx = keys.indexOf(k);
  if (idx < 0) return;
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= keys.length) return;
  const tmp = keys[idx]!;
  keys[idx] = keys[nextIdx]!;
  keys[nextIdx] = tmp;
  props.onPatch({ order: keys });
};
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

          <div class="space-y-1">
            <div
              v-for="k in orderedKeys"
              :key="k"
              class="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-accent/5"
            >
              <div class="flex items-center gap-2 min-w-0">
                <div class="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="h-6 w-6"
                    :title="t('app.settings.presetCardFooterMoveUp')"
                    @click="move(k, -1)"
                  >
                    <ArrowUp class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="h-6 w-6"
                    :title="t('app.settings.presetCardFooterMoveDown')"
                    @click="move(k, 1)"
                  >
                    <ArrowDown class="h-3.5 w-3.5" />
                  </Button>
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
