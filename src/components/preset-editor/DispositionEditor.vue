<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeepWritable, MappingConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

type StreamType = "v" | "a" | "s" | "d";

type DispositionRow =
  | { kind: "rule"; streamType: StreamType; streamIndex: number | null; valuePreset: string; valueRaw: string }
  | { kind: "raw"; value: string };

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping: DeepWritable<MappingConfig> = props.mapping;
const { t } = useI18n();

const PRESET_VALUES = [
  { value: "default", labelKey: "presetEditor.panel.dispositionValueDefault" },
  { value: "forced", labelKey: "presetEditor.panel.dispositionValueForced" },
  { value: "attached_pic", labelKey: "presetEditor.panel.dispositionValueAttachedPic" },
  { value: "0", labelKey: "presetEditor.panel.dispositionValueClear" },
  { value: "__custom__", labelKey: "presetEditor.panel.dispositionValueCustom" },
] as const;

const normalizeLegacySpecifier = (raw: string): string => {
  const s = String(raw ?? "").trim();
  if (/^\d+:(v|a|s|d)(:|$)/.test(s)) return s.replace(/^\d+:/, "");
  return s;
};

const parseRow = (rawLine: string): DispositionRow => {
  const trimmed = String(rawLine ?? "").trim();
  if (!trimmed) return { kind: "raw", value: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return { kind: "raw", value: trimmed };
  const spec = normalizeLegacySpecifier(parts[0] ?? "");
  const value = parts.slice(1).join(" ");
  const m = spec.match(/^(v|a|s|d)(?::(\d+))?$/);
  if (!m) return { kind: "raw", value: trimmed };
  const streamType = m[1] as StreamType;
  const streamIndex = typeof m[2] === "string" ? Number(m[2]) : null;
  const preset = PRESET_VALUES.some((p) => p.value === value) ? value : "__custom__";
  return { kind: "rule", streamType, streamIndex, valuePreset: preset, valueRaw: preset === "__custom__" ? value : "" };
};

const serializeRow = (row: DispositionRow): string => {
  if (row.kind === "raw") return String(row.value ?? "").trim();
  const idx =
    typeof row.streamIndex === "number" && Number.isFinite(row.streamIndex) && row.streamIndex >= 0
      ? `:${Math.trunc(row.streamIndex)}`
      : "";
  const spec = `${row.streamType}${idx}`;
  const value = row.valuePreset === "__custom__" ? String(row.valueRaw ?? "").trim() : row.valuePreset;
  if (!value) return "";
  return `${spec} ${value}`;
};

const snapshot = computed(() => (mapping.dispositions ?? []).join("\n"));
const rows = ref<DispositionRow[]>((mapping.dispositions ?? []).map(parseRow));
watch(
  snapshot,
  () => {
    rows.value = (mapping.dispositions ?? []).map(parseRow);
  },
  { flush: "sync" },
);

const writeBack = () => {
  const next = rows.value
    .map(serializeRow)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  mapping.dispositions = next.length > 0 ? next : undefined;
};
watch(
  rows,
  () => {
    writeBack();
  },
  { deep: true },
);

const addRow = () => {
  rows.value = [...rows.value, { kind: "rule", streamType: "a", streamIndex: 0, valuePreset: "default", valueRaw: "" }];
};
const removeRow = (idx: number) => {
  rows.value = rows.value.filter((_, i) => i !== idx);
};
</script>

<template>
  <div class="space-y-2" data-command-group="mapping" data-command-field="disposition" tabindex="-1">
    <div class="flex items-center gap-1">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.dispositionLabel") }}
      </Label>
      <HelpTooltipIcon :text="t('presetEditor.panel.dispositionHelp')" />
    </div>

    <div class="flex items-center justify-between gap-2">
      <p class="text-[11px] text-muted-foreground">
        {{ t("presetEditor.panel.dispositionEditorHint") }}
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
        data-testid="preset-mapping-disposition-row"
      >
        <div v-if="row.kind === 'raw'" class="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <div class="sm:col-span-5">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.dispositionRawLabel") }}
            </Label>
            <Input
              v-model="row.value"
              class="h-9 text-xs font-mono"
              :placeholder="t('presetEditor.panel.dispositionPlaceholder')"
            />
          </div>
          <div class="sm:col-span-1 flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 px-2 text-[11px]" @click="removeRow(idx)">
              {{ t("common.remove") }}
            </Button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div class="sm:col-span-2">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.dispositionStreamTypeLabel") }}
            </Label>
            <Select v-model="row.streamType">
              <SelectTrigger class="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="v">{{ t("presetEditor.panel.mapRulesStreamTypeVideo") }}</SelectItem>
                <SelectItem value="a">{{ t("presetEditor.panel.mapRulesStreamTypeAudio") }}</SelectItem>
                <SelectItem value="s">{{ t("presetEditor.panel.mapRulesStreamTypeSubtitle") }}</SelectItem>
                <SelectItem value="d">{{ t("presetEditor.panel.mapRulesStreamTypeData") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="sm:col-span-2">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.dispositionStreamIndexLabel") }}
            </Label>
            <Input
              :model-value="row.streamIndex == null ? '' : String(row.streamIndex)"
              type="number"
              min="0"
              step="1"
              class="h-9 text-xs"
              :placeholder="t('presetEditor.panel.dispositionStreamIndexAllPlaceholder')"
              @update:model-value="
                (value) => {
                  const raw = String(value ?? '').trim();
                  if (!raw) {
                    row.streamIndex = null;
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n) || n < 0) return;
                  row.streamIndex = Math.trunc(n);
                }
              "
            />
          </div>

          <div class="sm:col-span-4">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.dispositionValueLabel") }}
            </Label>
            <Select v-model="row.valuePreset">
              <SelectTrigger class="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in PRESET_VALUES" :key="p.value" :value="p.value">
                  {{ t(p.labelKey) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="sm:col-span-3">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.dispositionCustomLabel") }}
            </Label>
            <Input
              v-model="row.valueRaw"
              class="h-9 text-xs font-mono"
              :disabled="row.valuePreset !== '__custom__'"
              :placeholder="t('presetEditor.panel.dispositionCustomPlaceholder')"
            />
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
