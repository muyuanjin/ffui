<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { hasTauri } from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

const props = defineProps<{
  modelValue?: OutputPolicy;
  /** When true, disables directory + filename fields (used by Smart Scan replaceOriginal). */
  lockLocationAndName?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: OutputPolicy): void;
}>();

const { t } = useI18n();

const policy = computed<OutputPolicy>(() => props.modelValue ?? DEFAULT_OUTPUT_POLICY);

const updatePolicy = (patch: Partial<OutputPolicy>) => {
  emit("update:modelValue", { ...policy.value, ...patch });
};

const updateFilename = (patch: Partial<OutputPolicy["filename"]>) => {
  updatePolicy({ filename: { ...policy.value.filename, ...patch } });
};

const updateDirectory = (mode: OutputPolicy["directory"]["mode"], directory?: string) => {
  if (mode === "sameAsInput") {
    updatePolicy({ directory: { mode: "sameAsInput" } });
    return;
  }
  updatePolicy({ directory: { mode: "fixed", directory: directory ?? "" } });
};

const updateContainerMode = (mode: OutputPolicy["container"]["mode"]) => {
  if (mode === "force") {
    const current =
      policy.value.container.mode === "force" ? policy.value.container.format : "mkv";
    updatePolicy({ container: { mode: "force", format: current } });
    return;
  }
  if (mode === "default") {
    updatePolicy({ container: { mode: "default" } });
    return;
  }
  updatePolicy({ container: { mode: "keepInput" } });
};

const containerMode = computed(() => policy.value.container.mode);
const forcedContainerFormat = computed(() =>
  policy.value.container.mode === "force" ? policy.value.container.format : "mkv",
);

const directoryMode = computed(() => policy.value.directory.mode);
const fixedDirectory = computed(() =>
  policy.value.directory.mode === "fixed" ? policy.value.directory.directory : "",
);

const regexEnabled = computed(() => !!policy.value.filename.regexReplace);

const toggleRegex = () => {
  if (policy.value.filename.regexReplace) {
    updateFilename({ regexReplace: undefined });
  } else {
    updateFilename({ regexReplace: { pattern: "", replacement: "" } });
  }
};

const randomLenString = computed({
  get() {
    const len = policy.value.filename.randomSuffixLen;
    return typeof len === "number" && Number.isFinite(len) ? String(len) : "";
  },
  set(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      updateFilename({ randomSuffixLen: undefined });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(1, Math.min(32, Math.floor(n)));
    updateFilename({ randomSuffixLen: clamped });
  },
});

const pickDirectory = async () => {
  if (!hasTauri()) return;
  const selected = await openDialog({ multiple: false, directory: true });
  if (typeof selected === "string" && selected.trim()) {
    updateDirectory("fixed", selected);
  } else if (Array.isArray(selected) && typeof selected[0] === "string") {
    updateDirectory("fixed", selected[0]);
  }
};
</script>

<template>
  <section class="space-y-3">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label class="text-xs">{{ t("outputPolicy.containerLabel") }}</Label>
        <div class="flex items-center gap-2">
          <Select :model-value="containerMode" @update:model-value="(v) => updateContainerMode(v as any)">
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{{ t("outputPolicy.container.default") }}</SelectItem>
              <SelectItem value="keepInput">{{ t("outputPolicy.container.keepInput") }}</SelectItem>
              <SelectItem value="force">{{ t("outputPolicy.container.force") }}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            v-if="containerMode === 'force'"
            :model-value="forcedContainerFormat"
            @update:model-value="(v) => updatePolicy({ container: { mode: 'force', format: String(v) } })"
          >
            <SelectTrigger class="h-8 text-xs w-[108px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mkv">mkv</SelectItem>
              <SelectItem value="mp4">mp4</SelectItem>
              <SelectItem value="mov">mov</SelectItem>
              <SelectItem value="webm">webm</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="space-y-1.5" :class="props.lockLocationAndName ? 'opacity-60 pointer-events-none' : ''">
        <Label class="text-xs">{{ t("outputPolicy.dirLabel") }}</Label>
        <div class="flex items-center gap-2">
          <Select :model-value="directoryMode" @update:model-value="(v) => updateDirectory(v as any, fixedDirectory)">
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sameAsInput">{{ t("outputPolicy.dir.sameAsInput") }}</SelectItem>
              <SelectItem value="fixed">{{ t("outputPolicy.dir.fixed") }}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            v-if="directoryMode === 'fixed'"
            type="button"
            variant="secondary"
            size="sm"
            class="h-8 px-2 text-xs"
            @click="pickDirectory"
          >
            {{ t("outputPolicy.dir.pick") }}
          </Button>
        </div>
        <Input
          v-if="directoryMode === 'fixed'"
          :model-value="fixedDirectory"
          class="h-8 text-xs"
          :placeholder="t('outputPolicy.dir.placeholder') as string"
          @update:model-value="(v) => updateDirectory('fixed', String(v))"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-2" :class="props.lockLocationAndName ? 'opacity-60 pointer-events-none' : ''">
        <Label class="text-xs">{{ t("outputPolicy.nameLabel") }}</Label>

        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.name.prefix") }}</Label>
            <Input
              class="h-8 text-xs"
              :model-value="policy.filename.prefix || ''"
              @update:model-value="(v) => updateFilename({ prefix: String(v) || undefined })"
            />
          </div>
          <div class="space-y-1">
            <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.name.suffix") }}</Label>
            <Input
              class="h-8 text-xs"
              :model-value="policy.filename.suffix || ''"
              @update:model-value="(v) => updateFilename({ suffix: String(v) || undefined })"
            />
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Checkbox :checked="!!policy.filename.appendTimestamp" @update:checked="(v) => updateFilename({ appendTimestamp: !!v })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.name.timestamp") }}</span>
        </div>

        <div class="flex items-center gap-2">
          <Checkbox :checked="!!policy.filename.appendEncoderQuality" @update:checked="(v) => updateFilename({ appendEncoderQuality: !!v })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.name.encoderTag") }}</span>
        </div>

        <div class="flex items-center gap-2">
          <Checkbox :checked="policy.filename.randomSuffixLen !== undefined" @update:checked="(v) => updateFilename({ randomSuffixLen: v ? 6 : undefined })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.name.random") }}</span>
          <Input v-if="policy.filename.randomSuffixLen !== undefined" v-model="randomLenString" class="h-8 w-16 text-xs" />
          <span v-if="policy.filename.randomSuffixLen !== undefined" class="text-[10px] text-muted-foreground">
            {{ t("outputPolicy.name.randomHint") }}
          </span>
        </div>
      </div>

      <div class="space-y-2" :class="props.lockLocationAndName ? 'opacity-60 pointer-events-none' : ''">
        <div class="flex items-center justify-between">
          <Label class="text-xs">{{ t("outputPolicy.regexLabel") }}</Label>
          <div class="flex items-center gap-2">
            <Checkbox :checked="regexEnabled" @update:checked="toggleRegex" />
            <span class="text-xs text-muted-foreground">{{ t("outputPolicy.enabled") }}</span>
          </div>
        </div>

        <div v-if="regexEnabled" class="grid grid-cols-1 gap-2">
          <div class="space-y-1">
            <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.regex.pattern") }}</Label>
            <Input
              class="h-8 text-xs font-mono"
              :model-value="policy.filename.regexReplace?.pattern || ''"
              @update:model-value="(v) => updateFilename({ regexReplace: { pattern: String(v), replacement: policy.filename.regexReplace?.replacement || '' } })"
            />
          </div>
          <div class="space-y-1">
            <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.regex.replacement") }}</Label>
            <Input
              class="h-8 text-xs font-mono"
              :model-value="policy.filename.regexReplace?.replacement || ''"
              @update:model-value="(v) => updateFilename({ regexReplace: { pattern: policy.filename.regexReplace?.pattern || '', replacement: String(v) } })"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Checkbox :checked="!!policy.preserveFileTimes" @update:checked="(v) => updatePolicy({ preserveFileTimes: !!v })" />
      <span class="text-xs text-foreground">{{ t("outputPolicy.preserveTimes") }}</span>
    </div>

    <p v-if="props.lockLocationAndName" class="text-[10px] text-muted-foreground">
      {{ t("outputPolicy.smartScanLockHint") }}
    </p>
  </section>
</template>
