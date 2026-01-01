<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";

type GroupSummary = {
  errors: number;
  warnings: number;
  fixes: Array<unknown>;
};

const props = defineProps<{
  summary: GroupSummary | undefined;
}>();

const emit = defineEmits<{
  (e: "apply"): void;
}>();

const { t } = useI18n();

const isVisible = computed(() => {
  const s = props.summary;
  if (!s) return false;
  return Boolean(s.errors || s.warnings || (Array.isArray(s.fixes) && s.fixes.length > 0));
});

const canApply = computed(() => {
  const s = props.summary;
  return Boolean(s && Array.isArray(s.fixes) && s.fixes.length > 0);
});
</script>

<template>
  <div v-if="isVisible" class="rounded-md border border-border/60 bg-muted/40 p-3">
    <div class="flex items-center justify-between gap-3">
      <p class="text-[11px] text-muted-foreground">
        {{
          t("presetEditor.validation.groupSummary", { errors: summary?.errors ?? 0, warnings: summary?.warnings ?? 0 })
        }}
      </p>
      <Button
        v-if="canApply"
        type="button"
        variant="secondary"
        size="sm"
        class="h-7 px-2 text-[11px]"
        @click="emit('apply')"
      >
        {{ t("presetEditor.validation.fixGroup") }}
      </Button>
    </div>
  </div>
</template>
