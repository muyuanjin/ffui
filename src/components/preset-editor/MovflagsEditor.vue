<script setup lang="ts">
import { computed } from "vue";
import type { ContainerConfig, DeepWritable } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "vue-i18n";
import HelpTooltipIcon from "@/components/preset-editor/HelpTooltipIcon.vue";

const props = defineProps<{
  container: ContainerConfig;
}>();

const container: DeepWritable<ContainerConfig> = props.container;

const { t } = useI18n();

const CANONICAL_KNOWN_FLAGS = [
  "faststart",
  "frag_keyframe",
  "dash",
  "cmaf",
  "isml",
  "separate_moof",
  "omit_tfhd_offset",
  "default_base_moof",
  "skip_sidx",
  "skip_trailer",
] as const;

type KnownMovFlag = (typeof CANONICAL_KNOWN_FLAGS)[number];

const normalizeFlagKey = (raw: string) =>
  String(raw ?? "")
    .trim()
    .replace(/^\+/, "")
    .toLowerCase();

const existingFlagsByKey = computed(() => {
  const map = new Map<string, string>();
  for (const raw of container.movflags ?? []) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    map.set(normalizeFlagKey(trimmed), trimmed.replace(/^\+/, ""));
  }
  return map;
});

const selectedKnownKeys = computed<Set<string>>(() => {
  const keys = new Set<string>();
  for (const raw of container.movflags ?? []) {
    const key = normalizeFlagKey(raw);
    if (key) keys.add(key);
  }
  return keys;
});

const customFlagsText = computed<string>({
  get() {
    const known = new Set<string>(CANONICAL_KNOWN_FLAGS as unknown as string[]);
    const parts: string[] = [];
    for (const raw of container.movflags ?? []) {
      const trimmed = String(raw ?? "")
        .trim()
        .replace(/^\+/, "");
      if (!trimmed) continue;
      if (!known.has(trimmed.toLowerCase())) parts.push(trimmed);
    }
    return parts.join("+");
  },
  set(value) {
    const text = String(value ?? "");
    const parts = text
      .split(/[+,]/)
      .map((v) => v.trim().replace(/^\+/, ""))
      .filter((v) => v.length > 0);
    rebuildMovflags(parts);
  },
});

const rebuildMovflags = (customFlags: string[]) => {
  const existing = existingFlagsByKey.value;
  const selected = selectedKnownKeys.value;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const flag of CANONICAL_KNOWN_FLAGS) {
    const key = String(flag);
    if (!selected.has(key)) continue;
    const raw = existing.get(key) ?? key;
    if (seen.has(key)) continue;
    out.push(raw);
    seen.add(key);
  }

  for (const rawFlag of customFlags) {
    const trimmed = String(rawFlag ?? "")
      .trim()
      .replace(/^\+/, "");
    if (!trimmed) continue;
    const key = normalizeFlagKey(trimmed);
    if (!key || seen.has(key)) continue;
    out.push(trimmed);
    seen.add(key);
  }

  container.movflags = out.length > 0 ? out : undefined;
};

const toggleKnownFlag = (flag: KnownMovFlag, nextChecked: boolean) => {
  const key = String(flag);
  const next = new Set<string>(selectedKnownKeys.value);
  if (nextChecked) next.add(key);
  else next.delete(key);
  const custom = customFlagsText.value
    .split(/[+,]/)
    .map((v) => v.trim().replace(/^\+/, ""))
    .filter((v) => v.length > 0);

  const existing = existingFlagsByKey.value;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of CANONICAL_KNOWN_FLAGS) {
    const k = String(f);
    if (!next.has(k)) continue;
    const raw = existing.get(k) ?? k;
    if (seen.has(k)) continue;
    out.push(raw);
    seen.add(k);
  }
  for (const rawFlag of custom) {
    const trimmed = String(rawFlag ?? "")
      .trim()
      .replace(/^\+/, "");
    if (!trimmed) continue;
    const k = normalizeFlagKey(trimmed);
    if (!k || seen.has(k)) continue;
    out.push(trimmed);
    seen.add(k);
  }
  container.movflags = out.length > 0 ? out : undefined;
};
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-1">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.movflagsLabel") }}
      </Label>
      <HelpTooltipIcon :text="t('presetEditor.panel.movflagsHelp')" />
    </div>

    <div class="grid grid-cols-2 gap-2">
      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          :checked="selectedKnownKeys.has('faststart')"
          class="h-3 w-3 border-border bg-background"
          @update:checked="(v) => toggleKnownFlag('faststart', Boolean(v))"
        />
        <span class="font-mono">faststart</span>
      </label>

      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          :checked="selectedKnownKeys.has('frag_keyframe')"
          class="h-3 w-3 border-border bg-background"
          @update:checked="(v) => toggleKnownFlag('frag_keyframe', Boolean(v))"
        />
        <span class="font-mono">frag_keyframe</span>
      </label>

      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          :checked="selectedKnownKeys.has('dash')"
          class="h-3 w-3 border-border bg-background"
          @update:checked="(v) => toggleKnownFlag('dash', Boolean(v))"
        />
        <span class="font-mono">dash</span>
      </label>

      <label class="inline-flex items-center gap-2 text-[10px]">
        <Checkbox
          :checked="selectedKnownKeys.has('cmaf')"
          class="h-3 w-3 border-border bg-background"
          @update:checked="(v) => toggleKnownFlag('cmaf', Boolean(v))"
        />
        <span class="font-mono">cmaf</span>
      </label>
    </div>

    <div class="space-y-1">
      <Label class="text-[10px] block">
        {{ t("presetEditor.panel.movflagsCustomLabel") }}
      </Label>
      <Input
        v-model="customFlagsText"
        class="h-8 text-xs font-mono"
        :placeholder="t('presetEditor.panel.movflagsCustomPlaceholder')"
      />
      <p class="text-[11px] text-muted-foreground">
        {{ t("presetEditor.panel.movflagsCustomHelp") }}
      </p>
    </div>
  </div>
</template>
