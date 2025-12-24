<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSortable } from "@vueuse/integrations/useSortable";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GripVertical } from "lucide-vue-next";

import type { OutputFilenameAppend, OutputFilenamePolicy } from "@/types";
import { normalizeAppendOrder } from "@/lib/outputPolicyPreview";
import type { SortableEvent } from "sortablejs";

const props = defineProps<{
  filename: OutputFilenamePolicy;
}>();

const emit = defineEmits<{
  (e: "update", patch: Partial<OutputFilenamePolicy>): void;
}>();

const { t } = useI18n();

const fullOrder = computed<OutputFilenameAppend[]>(() => normalizeAppendOrder(props.filename.appendOrder));

const order = ref<OutputFilenameAppend[]>([]);
watch(
  fullOrder,
  (next) => {
    const same = order.value.length === next.length && order.value.every((it, idx) => it === next[idx]);
    if (!same) order.value = [...next];
  },
  { immediate: true },
);

const isEnabled = (item: OutputFilenameAppend) => {
  if (item === "suffix") return !!props.filename.suffix?.length;
  if (item === "timestamp") return !!props.filename.appendTimestamp;
  if (item === "encoderQuality") return !!props.filename.appendEncoderQuality;
  return typeof props.filename.randomSuffixLen === "number" && props.filename.randomSuffixLen > 0;
};

const labelFor = (item: OutputFilenameAppend) => {
  if (item === "suffix") return t("outputPolicy.name.suffix");
  if (item === "timestamp") return t("outputPolicy.name.timestamp");
  if (item === "encoderQuality") return t("outputPolicy.name.encoderTag");
  return t("outputPolicy.name.random");
};

const setEnabled = (item: OutputFilenameAppend, enabled: boolean) => {
  if (item === "suffix") {
    if (enabled) {
      const current = (props.filename.suffix ?? "").trim();
      emit("update", { suffix: current.length > 0 ? current : ".compressed" });
    } else {
      emit("update", { suffix: undefined });
    }
    return;
  }

  if (item === "timestamp") {
    emit("update", { appendTimestamp: enabled });
    return;
  }

  if (item === "encoderQuality") {
    emit("update", { appendEncoderQuality: enabled });
    return;
  }

  if (enabled) {
    const current = props.filename.randomSuffixLen;
    const normalized = typeof current === "number" && Number.isFinite(current) && current > 0 ? Math.floor(current) : 6;
    emit("update", { randomSuffixLen: normalized });
  } else {
    emit("update", { randomSuffixLen: undefined });
  }
};

const updateSuffix = (value: string | number) => {
  const raw = String(value ?? "");
  const next = raw.length > 0 ? raw : undefined;
  emit("update", { suffix: next });
};

const updateRandomLen = (value: string | number) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    emit("update", { randomSuffixLen: undefined });
    return;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return;
  const clamped = Math.max(1, Math.min(32, Math.floor(n)));
  emit("update", { randomSuffixLen: clamped });
};

const sortableRef = ref<HTMLElement | null>(null);
useSortable(sortableRef, order, {
  animation: 150,
  handle: ".drag-handle",
  ghostClass: "opacity-30",
  chosenClass: "is-chosen",
  forceFallback: true,
  fallbackOnBody: true,
  fallbackClass: "drag-fallback",
  onUpdate: (e: SortableEvent) => {
    const oldIndex = e?.oldIndex;
    const newIndex = e?.newIndex;
    if (typeof oldIndex !== "number" || typeof newIndex !== "number") return;
    if (oldIndex === newIndex) return;
    if (oldIndex < 0 || oldIndex >= order.value.length) return;
    if (newIndex < 0 || newIndex >= order.value.length) return;

    const next = [...order.value];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    order.value = next;
    emit("update", { appendOrder: next });
  },
});
</script>

<template>
  <div class="rounded-md border border-border/60 bg-background/60 p-3 space-y-2 h-full">
    <div class="space-y-0.5">
      <Label class="text-xs whitespace-nowrap">{{ t("outputPolicy.appendOrderLabel") }}</Label>
      <p class="text-[10px] text-muted-foreground leading-tight">{{ t("outputPolicy.appendOrderHint") }}</p>
    </div>

    <div ref="sortableRef" class="space-y-2" data-testid="append-order-list">
      <div
        v-for="item in order"
        :key="item"
        class="rounded-md border border-border/60 bg-card/40 p-2 flex items-start gap-2"
        :data-testid="`append-order-item-${item}`"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="drag-handle mt-0.5 text-muted-foreground hover:text-foreground"
          :data-testid="`append-order-handle-${item}`"
        >
          <GripVertical class="h-4 w-4" />
        </Button>

        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <Checkbox
                :checked="isEnabled(item)"
                :data-testid="`append-order-enable-${item}`"
                @update:checked="(v) => setEnabled(item, !!v)"
              />
              <span class="text-xs text-foreground truncate">
                {{ labelFor(item) }}
              </span>
            </div>
          </div>

          <div v-if="item === 'suffix'" class="pl-6">
            <Input
              class="h-8 text-xs"
              :disabled="!isEnabled('suffix')"
              :model-value="props.filename.suffix ?? ''"
              :data-testid="`append-order-param-suffix`"
              @update:model-value="updateSuffix"
            />
          </div>

          <div v-if="item === 'random'" class="pl-6">
            <Input
              class="h-8 text-xs"
              :disabled="!isEnabled('random')"
              :model-value="
                typeof props.filename.randomSuffixLen === 'number' ? String(props.filename.randomSuffixLen) : ''
              "
              :data-testid="`append-order-param-random`"
              @update:model-value="updateRandomLen"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
