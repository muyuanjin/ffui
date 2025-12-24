<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Check } from "lucide-vue-next";
import type { Translate } from "@/types";

export type PresetKind = "structured" | "custom";

const props = defineProps<{
  kind: PresetKind;
  t: Translate;
}>();

const emit = defineEmits<{
  (e: "update:kind", value: PresetKind): void;
}>();
</script>

<template>
  <div class="space-y-4" data-testid="preset-kind-step">
    <div>
      <h3 class="text-base font-semibold">{{ t("presetEditor.kind.title") }}</h3>
      <p class="text-xs text-muted-foreground mt-1">
        {{ t("presetEditor.kind.description") }}
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        class="h-auto px-4 py-4 justify-start text-left bg-card/40 border-border/60 hover:bg-card/80"
        data-testid="preset-kind-structured"
        @click="emit('update:kind', 'structured')"
      >
        <div class="w-full flex gap-3 items-start">
          <div
            class="mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0"
            :class="props.kind === 'structured' ? 'border-primary text-primary' : 'border-border text-muted-foreground'"
          >
            <Check v-if="props.kind === 'structured'" class="w-3.5 h-3.5" />
          </div>
          <div class="min-w-0">
            <div class="font-medium text-sm text-foreground">{{ t("presetEditor.kind.structuredTitle") }}</div>
            <div class="text-[11px] text-muted-foreground mt-1">
              {{ t("presetEditor.kind.structuredDescription") }}
            </div>
          </div>
        </div>
      </Button>

      <Button
        type="button"
        variant="outline"
        class="h-auto px-4 py-4 justify-start text-left bg-card/40 border-border/60 hover:bg-card/80"
        data-testid="preset-kind-custom"
        @click="emit('update:kind', 'custom')"
      >
        <div class="w-full flex gap-3 items-start">
          <div
            class="mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0"
            :class="props.kind === 'custom' ? 'border-primary text-primary' : 'border-border text-muted-foreground'"
          >
            <Check v-if="props.kind === 'custom'" class="w-3.5 h-3.5" />
          </div>
          <div class="min-w-0">
            <div class="font-medium text-sm text-foreground">{{ t("presetEditor.kind.customTitle") }}</div>
            <div class="text-[11px] text-muted-foreground mt-1">
              {{ t("presetEditor.kind.customDescription") }}
            </div>
          </div>
        </div>
      </Button>
    </div>
  </div>
</template>
