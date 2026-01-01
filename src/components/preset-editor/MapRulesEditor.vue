<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeepWritable, MappingConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

type StreamType = "v" | "a" | "s" | "d";

type MapRuleRow =
  | { kind: "all"; inputIndex: number; optional: boolean }
  | { kind: "stream"; inputIndex: number; streamType: StreamType; streamIndex: number | null; optional: boolean }
  | { kind: "raw"; value: string };

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping: DeepWritable<MappingConfig> = props.mapping;
const { t } = useI18n();

const parseMapRule = (rawLine: string): MapRuleRow => {
  const trimmed = String(rawLine ?? "").trim();
  if (!trimmed) return { kind: "raw", value: "" };

  const optional = trimmed.endsWith("?");
  const body = optional ? trimmed.slice(0, -1) : trimmed;

  if (/^\d+$/.test(body)) {
    return { kind: "all", inputIndex: Number(body), optional };
  }
  const m = body.match(/^(\d+):([vasd])(?::(\d+))?$/);
  if (m) {
    const inputIndex = Number(m[1]);
    const streamType = m[2] as StreamType;
    const streamIndex = typeof m[3] === "string" ? Number(m[3]) : null;
    return { kind: "stream", inputIndex, streamType, streamIndex, optional };
  }
  return { kind: "raw", value: trimmed };
};

const serializeMapRule = (row: MapRuleRow): string => {
  if (row.kind === "raw") return String(row.value ?? "").trim();
  const inputIndex = Number.isFinite(row.inputIndex) && row.inputIndex >= 0 ? Math.trunc(row.inputIndex) : 0;
  const suffix = row.optional ? "?" : "";
  if (row.kind === "all") return `${inputIndex}${suffix}`;
  const type = row.streamType;
  const indexPart =
    typeof row.streamIndex === "number" && Number.isFinite(row.streamIndex) && row.streamIndex >= 0
      ? `:${Math.trunc(row.streamIndex)}`
      : "";
  return `${inputIndex}:${type}${indexPart}${suffix}`;
};

const snapshot = computed(() => (mapping.maps ?? []).join("\n"));
const rows = ref<MapRuleRow[]>((mapping.maps ?? []).map(parseMapRule));
watch(
  snapshot,
  () => {
    rows.value = (mapping.maps ?? []).map(parseMapRule);
  },
  { flush: "sync" },
);

const writeBack = () => {
  const next = rows.value
    .map(serializeMapRule)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  mapping.maps = next.length > 0 ? next : undefined;
};

watch(
  rows,
  () => {
    writeBack();
  },
  { deep: true },
);

const mappingModeValue = computed<"auto" | "custom">({
  get() {
    return (mapping.maps ?? []).length > 0 ? "custom" : "auto";
  },
  set(value) {
    if (value === "auto") {
      mapping.maps = undefined;
      rows.value = [];
      return;
    }
    if (rows.value.length === 0) {
      rows.value = [{ kind: "all", inputIndex: 0, optional: false }];
    }
  },
});

const addAllRule = () => {
  rows.value = [...rows.value, { kind: "all", inputIndex: 0, optional: false }];
};
const addStreamRule = () => {
  rows.value = [...rows.value, { kind: "stream", inputIndex: 0, streamType: "v", streamIndex: 0, optional: false }];
};
const removeRule = (idx: number) => {
  rows.value = rows.value.filter((_, i) => i !== idx);
};
</script>

<template>
  <div class="space-y-2" data-command-group="mapping" data-command-field="map" tabindex="-1">
    <div class="flex items-center gap-1">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.mapLabel") }}
      </Label>
      <HelpTooltipIcon :text="t('presetEditor.panel.mapHelp')" />
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-1">
          <Label class="text-[10px] block">
            {{ t("presetEditor.panel.mapRulesModeLabel") }}
          </Label>
          <HelpTooltipIcon :text="t('presetEditor.panel.mapRulesModeHelp')" />
        </div>
        <Select v-model="mappingModeValue">
          <SelectTrigger class="h-9 text-xs" data-testid="preset-mapping-map-mode-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {{ t("presetEditor.panel.mapRulesModeAuto") }}
            </SelectItem>
            <SelectItem value="custom">
              {{ t("presetEditor.panel.mapRulesModeCustom") }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[11px] text-muted-foreground">
          {{ t("presetEditor.panel.mapRulesModeHint") }}
        </p>
      </div>

      <div v-if="mappingModeValue === 'custom'" class="flex items-end gap-2">
        <Button variant="outline" size="sm" class="h-9 px-3 text-[11px]" @click="addAllRule">
          {{ t("presetEditor.panel.mapRulesAddAll") }}
        </Button>
        <Button variant="outline" size="sm" class="h-9 px-3 text-[11px]" @click="addStreamRule">
          {{ t("presetEditor.panel.mapRulesAddStream") }}
        </Button>
      </div>
    </div>

    <div v-if="mappingModeValue === 'custom'" class="space-y-2">
      <div
        v-for="(row, idx) in rows"
        :key="idx"
        class="rounded border border-border/60 bg-background/40 p-2"
        data-testid="preset-mapping-map-rule-row"
      >
        <div v-if="row.kind === 'raw'" class="grid grid-cols-1 sm:grid-cols-6 gap-2 items-end">
          <div class="sm:col-span-5">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.mapRulesRawLabel") }}
            </Label>
            <Input
              v-model="row.value"
              class="h-9 text-xs font-mono"
              :placeholder="t('presetEditor.panel.mapPlaceholder')"
            />
          </div>
          <div class="sm:col-span-1 flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 px-2 text-[11px]" @click="removeRule(idx)">
              {{ t("common.remove") }}
            </Button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div class="sm:col-span-2">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.mapRulesInputIndex") }}
            </Label>
            <Input v-model.number="row.inputIndex" type="number" min="0" step="1" class="h-9 text-xs" />
          </div>

          <div class="sm:col-span-3">
            <Label class="text-[10px] block">
              {{ t("presetEditor.panel.mapRulesTarget") }}
            </Label>
            <Select
              :model-value="row.kind"
              @update:model-value="
                (value) => {
                  const raw = String(value ?? '');
                  if (raw === 'all') {
                    rows[idx] = { kind: 'all', inputIndex: row.inputIndex, optional: row.optional };
                    return;
                  }
                  if (raw === 'stream') {
                    rows[idx] = {
                      kind: 'stream',
                      inputIndex: row.inputIndex,
                      streamType: 'v',
                      streamIndex: 0,
                      optional: row.optional,
                    };
                    return;
                  }
                  rows[idx] = { kind: 'raw', value: serializeMapRule(row) };
                }
              "
            >
              <SelectTrigger class="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ t("presetEditor.panel.mapRulesTargetAll") }}</SelectItem>
                <SelectItem value="stream">{{ t("presetEditor.panel.mapRulesTargetStream") }}</SelectItem>
                <SelectItem value="raw">{{ t("presetEditor.panel.mapRulesTargetRaw") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <template v-if="row.kind === 'stream'">
            <div class="sm:col-span-2">
              <Label class="text-[10px] block">
                {{ t("presetEditor.panel.mapRulesStreamType") }}
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

            <div class="sm:col-span-3">
              <Label class="text-[10px] block">
                {{ t("presetEditor.panel.mapRulesStreamIndex") }}
              </Label>
              <Input
                :model-value="row.streamIndex == null ? '' : String(row.streamIndex)"
                type="number"
                min="0"
                step="1"
                class="h-9 text-xs"
                :placeholder="t('presetEditor.panel.mapRulesStreamIndexAllPlaceholder')"
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
          </template>

          <div class="sm:col-span-2 flex items-center gap-2">
            <label class="inline-flex items-center gap-2 text-[10px]">
              <Checkbox v-model:checked="row.optional" class="h-3 w-3 border-border bg-background" />
              <span>{{ t("presetEditor.panel.mapRulesOptional") }}</span>
            </label>
          </div>

          <div class="sm:col-span-2 flex justify-end">
            <Button variant="ghost" size="sm" class="h-9 px-2 text-[11px]" @click="removeRule(idx)">
              {{ t("common.remove") }}
            </Button>
          </div>
        </div>

        <p class="text-[11px] text-muted-foreground mt-1 font-mono">
          {{ serializeMapRule(row) }}
        </p>
      </div>
    </div>
  </div>
</template>
