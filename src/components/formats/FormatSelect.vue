<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { FormatCatalogEntry, FormatKind } from "@/lib/formatCatalog";
import { filterFormatCatalog, groupFormatCatalog } from "@/lib/formatCatalog";

const props = defineProps<{
  modelValue: string;
  entries: FormatCatalogEntry[];
  placeholder?: string;
  /** Optional "auto" option value (rendered as a fixed item before groups). */
  autoValue?: string;
  /** Label for the optional auto option. */
  autoLabel?: string;
  /** Optional filter: only show these kinds (others are hidden). */
  allowedKinds?: FormatKind[];
  /** Optional extra classes for SelectTrigger (appended after defaults). */
  triggerClass?: string;
  /** Optional extra classes for SelectContent (appended after defaults). */
  contentClass?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const query = ref("");

const { t } = useI18n();

const selectedEntry = computed(() => props.entries.find((e) => e.value === props.modelValue) ?? null);
const selectedLabel = computed(() => {
  if (props.autoValue && props.modelValue === props.autoValue) {
    return props.autoLabel ?? props.modelValue;
  }
  return selectedEntry.value?.label ?? props.modelValue;
});

const visibleEntries = computed(() => {
  const allowed = props.allowedKinds?.length
    ? props.entries.filter((e) => props.allowedKinds!.includes(e.kind))
    : props.entries;
  return filterFormatCatalog(allowed, query.value);
});

const groups = computed(() => groupFormatCatalog(visibleEntries.value));
const hasAny = computed(() => visibleEntries.value.length > 0);

// When the selection changes externally, keep query stable; but when entries
// shrink to empty due to filtering, offer a quick reset.
watch(
  () => props.modelValue,
  () => {
    // no-op: keep search text
  },
);
</script>

<template>
  <Select :model-value="modelValue" @update:model-value="(v) => emit('update:modelValue', String(v))">
    <SelectTrigger class="h-8 text-xs w-[220px]" :class="triggerClass" :title="selectedLabel">
      <SelectValue :placeholder="placeholder ?? t('formatSelect.placeholder')">
        <template v-if="selectedLabel">{{ selectedLabel }}</template>
      </SelectValue>
    </SelectTrigger>
    <SelectContent class="w-[320px]" :class="contentClass">
      <div class="p-1">
        <Input v-model="query" class="h-8 text-xs" :placeholder="t('formatSelect.searchPlaceholder') as string" />
      </div>
      <Separator class="my-1" />

      <template v-if="autoValue">
        <SelectItem :value="autoValue">
          {{ autoLabel ?? autoValue }}
        </SelectItem>
        <Separator class="my-1" />
      </template>

      <template v-if="hasAny">
        <template v-if="groups.video.length">
          <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ t("formatSelect.groups.video") }}
          </div>
          <SelectItem v-for="e in groups.video" :key="e.value" :value="e.value" :disabled="!!e.disabledInVideoPickers">
            <div class="flex flex-col">
              <span class="text-sm">{{ e.label }}</span>
              <span v-if="e.note" class="text-[10px] text-muted-foreground leading-tight">{{ e.note }}</span>
            </div>
          </SelectItem>
        </template>

        <template v-if="groups.audio.length">
          <Separator class="my-1" />
          <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ t("formatSelect.groups.audio") }}
          </div>
          <SelectItem v-for="e in groups.audio" :key="e.value" :value="e.value" :disabled="true">
            <div class="flex flex-col">
              <span class="text-sm">{{ e.label }}</span>
              <span class="text-[10px] text-muted-foreground leading-tight">
                {{ t("formatSelect.disabledHints.audio") }}
              </span>
            </div>
          </SelectItem>
        </template>

        <template v-if="groups.image.length">
          <Separator class="my-1" />
          <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ t("formatSelect.groups.image") }}
          </div>
          <SelectItem v-for="e in groups.image" :key="e.value" :value="e.value" :disabled="true">
            <div class="flex flex-col">
              <span class="text-sm">{{ e.label }}</span>
              <span class="text-[10px] text-muted-foreground leading-tight">
                {{ t("formatSelect.disabledHints.image") }}
              </span>
            </div>
          </SelectItem>
        </template>
      </template>

      <template v-else>
        <div class="px-2 py-2 text-xs text-muted-foreground">
          {{ t("formatSelect.emptyHint") }}
        </div>
      </template>
    </SelectContent>
  </Select>
</template>
