<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppSettings, PresetCardFooterItemKey, PresetCardFooterLayout, PresetCardFooterSettings } from "@/types";
import PresetCardFooterSettingsDialog from "@/components/dialogs/PresetCardFooterSettingsDialog.vue";

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();
const detailOpen = ref(false);

const DEFAULT_FOOTER: Required<PresetCardFooterSettings> = {
  layout: "twoRows",
  order: ["avgSize", "fps", "vmaf", "usedCount", "dataAmount", "throughput"],
  showAvgSize: true,
  showFps: true,
  showVmaf: true,
  showUsedCount: true,
  showDataAmount: true,
  showThroughput: true,
};

const normalizeFooter = (input: PresetCardFooterSettings | undefined | null): PresetCardFooterSettings | undefined => {
  const current = input ?? {};
  const layout: PresetCardFooterLayout =
    current.layout === "oneRow" || current.layout === "twoRows" ? current.layout : "twoRows";

  const normalizeOrder = (order: PresetCardFooterItemKey[] | undefined): PresetCardFooterItemKey[] | undefined => {
    const defaults = DEFAULT_FOOTER.order;
    const raw = Array.isArray(order) ? order : [];
    const seen = new Set<PresetCardFooterItemKey>();
    const out: PresetCardFooterItemKey[] = [];
    for (const k of raw) {
      if (!defaults.includes(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    for (const k of defaults) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    const isDefault = out.length === defaults.length && out.every((v, i) => v === defaults[i]);
    return isDefault ? undefined : out;
  };

  const normalizedOrder = normalizeOrder(current.order);

  const next: PresetCardFooterSettings = {
    layout,
    order: normalizedOrder,
    showAvgSize: current.showAvgSize ?? true,
    showFps: current.showFps ?? true,
    showVmaf: current.showVmaf ?? true,
    showUsedCount: current.showUsedCount ?? true,
    showDataAmount: current.showDataAmount ?? true,
    showThroughput: current.showThroughput ?? true,
  };

  const isDefault =
    next.layout === DEFAULT_FOOTER.layout &&
    normalizedOrder == null &&
    next.showAvgSize === DEFAULT_FOOTER.showAvgSize &&
    next.showFps === DEFAULT_FOOTER.showFps &&
    next.showVmaf === DEFAULT_FOOTER.showVmaf &&
    next.showUsedCount === DEFAULT_FOOTER.showUsedCount &&
    next.showDataAmount === DEFAULT_FOOTER.showDataAmount &&
    next.showThroughput === DEFAULT_FOOTER.showThroughput;

  return isDefault ? undefined : next;
};

const effective = computed<Required<PresetCardFooterSettings>>(() => {
  const s = props.appSettings?.presetCardFooter;
  const defaults = DEFAULT_FOOTER.order;
  const rawOrder = (s?.order ?? defaults) as PresetCardFooterItemKey[];
  const seen = new Set<PresetCardFooterItemKey>();
  const normalizedOrder: PresetCardFooterItemKey[] = [];
  for (const k of Array.isArray(rawOrder) ? rawOrder : []) {
    if (!defaults.includes(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    normalizedOrder.push(k);
  }
  for (const k of defaults) if (!seen.has(k)) normalizedOrder.push(k);

  return {
    layout: (s?.layout === "oneRow" || s?.layout === "twoRows" ? s.layout : "twoRows") as PresetCardFooterLayout,
    order: normalizedOrder,
    showAvgSize: s?.showAvgSize ?? true,
    showFps: s?.showFps ?? true,
    showVmaf: s?.showVmaf ?? true,
    showUsedCount: s?.showUsedCount ?? true,
    showDataAmount: s?.showDataAmount ?? true,
    showThroughput: s?.showThroughput ?? true,
  };
});

const updateFooter = (patch: Partial<PresetCardFooterSettings>) => {
  if (!props.appSettings) return;
  const nextFooter = normalizeFooter({ ...effective.value, ...patch });
  emit("update:appSettings", { ...props.appSettings, presetCardFooter: nextFooter });
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm" data-testid="settings-preset-card-footer">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.presetCardFooterTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2 space-y-2">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.presetCardFooterDescription") }}
      </p>

      <div class="flex items-center justify-between gap-2 rounded border border-border/40 bg-muted/10 px-2 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="!props.appSettings"
          @click="updateFooter({ layout: effective.layout === 'twoRows' ? 'oneRow' : 'twoRows' })"
        >
          {{
            t("app.settings.presetCardFooterLayoutButton", {
              layout:
                effective.layout === "twoRows"
                  ? t("app.settings.presetCardFooterLayoutTwoRows")
                  : t("app.settings.presetCardFooterLayoutOneRow"),
            })
          }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-[11px]"
          :disabled="!props.appSettings"
          @click="detailOpen = true"
        >
          {{ t("app.settings.presetCardFooterDetailOpen") }}
        </Button>
      </div>

      <PresetCardFooterSettingsDialog
        :open="detailOpen"
        :footer-settings="effective"
        :on-patch="updateFooter"
        @update:open="detailOpen = $event"
      />
    </CardContent>
  </Card>
</template>
