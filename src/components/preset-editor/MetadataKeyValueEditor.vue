<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeepWritable, MappingConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

type MetadataRow = { kind: "kv"; key: string; value: string } | { kind: "raw"; value: string };

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping: DeepWritable<MappingConfig> = props.mapping;
const { t } = useI18n();

const COMMON_KEYS = ["title", "artist", "album", "comment", "genre", "date", "creation_time"] as const;

const parseRow = (rawLine: string): MetadataRow => {
  const trimmed = String(rawLine ?? "").trim();
  if (!trimmed) return { kind: "raw", value: "" };
  const idx = trimmed.indexOf("=");
  if (idx <= 0) return { kind: "raw", value: trimmed };
  return {
    kind: "kv",
    key: trimmed.slice(0, idx).trim(),
    value: trimmed.slice(idx + 1),
  };
};

const serializeRow = (row: MetadataRow): string => {
  if (row.kind === "raw") return String(row.value ?? "").trim();
  const key = String(row.key ?? "").trim();
  if (!key) return "";
  return `${key}=${String(row.value ?? "")}`;
};

const snapshot = computed(() => (mapping.metadata ?? []).join("\n"));
const rows = ref<MetadataRow[]>((mapping.metadata ?? []).map(parseRow));
watch(
  snapshot,
  () => {
    rows.value = (mapping.metadata ?? []).map(parseRow);
  },
  { flush: "sync" },
);

const writeBack = () => {
  const next = rows.value
    .map(serializeRow)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  mapping.metadata = next.length > 0 ? next : undefined;
};

watch(
  rows,
  () => {
    writeBack();
  },
  { deep: true },
);

const addRow = () => {
  rows.value = [...rows.value, { kind: "kv", key: "title", value: "" }];
};
const removeRow = (idx: number) => {
  rows.value = rows.value.filter((_, i) => i !== idx);
};
</script>

<template>
  <div class="space-y-2" data-command-group="mapping" data-command-field="metadata" tabindex="-1">
    <div class="flex items-center gap-1">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.metadataLabel") }}
      </Label>
      <HelpTooltipIcon :text="t('presetEditor.panel.metadataHelp')" />
    </div>

    <div class="flex items-center justify-between gap-2">
      <p class="text-[11px] text-muted-foreground">
        {{ t("presetEditor.panel.metadataTableHint") }}
      </p>
      <Button variant="outline" size="sm" class="h-8 px-2 text-[11px]" @click="addRow">
        {{ t("common.add") }}
      </Button>
    </div>

    <div class="space-y-2">
      <div
        v-for="(row, idx) in rows"
        :key="idx"
        class="rounded border border-border/60 bg-background/40 p-2"
        data-testid="preset-mapping-metadata-row"
      >
        <div v-if="row.kind === 'raw'" class="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <div class="sm:col-span-5">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.metadataRawLabel") }}
            </Label>
            <Input
              v-model="row.value"
              class="h-9 text-xs font-mono"
              :placeholder="t('presetEditor.panel.metadataPlaceholder')"
            />
          </div>
          <div class="sm:col-span-1 flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 px-2 text-[11px]" @click="removeRow(idx)">
              {{ t("common.remove") }}
            </Button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div class="sm:col-span-4">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.metadataKeyLabel") }}
            </Label>
            <div class="flex gap-2">
              <Select
                :model-value="COMMON_KEYS.includes(row.key as any) ? row.key : '__custom__'"
                @update:model-value="
                  (value) => {
                    const v = String(value ?? '').trim();
                    if (!v) return;
                    if (v === '__custom__') return;
                    row.key = v;
                  }
                "
              >
                <SelectTrigger class="h-9 text-xs w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="k in COMMON_KEYS" :key="k" :value="k">
                    {{ k }}
                  </SelectItem>
                  <SelectItem value="__custom__">
                    {{ t("presetEditor.panel.customKeyOption") }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input v-model="row.key" class="h-9 text-xs font-mono flex-1" />
            </div>
          </div>

          <div class="sm:col-span-7">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.metadataValueLabel") }}
            </Label>
            <Input v-model="row.value" class="h-9 text-xs font-mono" />
          </div>

          <div class="sm:col-span-1 flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 px-2 text-[11px]" @click="removeRow(idx)">
              {{ t("common.remove") }}
            </Button>
          </div>
        </div>

        <p class="text-[11px] text-muted-foreground mt-1 font-mono">
          {{ serializeRow(row) }}
        </p>
      </div>
    </div>
  </div>
</template>
