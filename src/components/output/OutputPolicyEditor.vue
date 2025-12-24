<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { hasTauri, previewOutputPath } from "@/lib/backend";
import { previewOutputPathLocal } from "@/lib/outputPolicyPreview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import OutputAppendOrderEditor from "@/components/output/OutputAppendOrderEditor.vue";
import FormatSelect from "@/components/formats/FormatSelect.vue";
import { FORMAT_CATALOG } from "@/lib/formatCatalog";
const props = defineProps<{
  modelValue?: OutputPolicy;
  /** When true, disables directory + filename fields (used by Batch Compress replaceOriginal). */
  lockLocationAndName?: boolean;
  /** Optional preset id used for previewing default container + encoder tag. */
  previewPresetId?: string | null;
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
    const current = policy.value.container.mode === "force" ? policy.value.container.format : "mkv";
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

const containerModeLabel = computed(() => {
  const value = containerMode.value;
  const map: Record<OutputPolicy["container"]["mode"], string> = {
    default: t("outputPolicy.container.default"),
    keepInput: t("outputPolicy.container.keepInput"),
    force: t("outputPolicy.container.force"),
  };
  return map[value] ?? "";
});

const queueOutputContainerEntries = computed(() =>
  FORMAT_CATALOG.filter((e) => e.kind !== "video" || !["mpegts", "hls", "dash"].includes(e.value)),
);

const directoryMode = computed(() => policy.value.directory.mode);
const fixedDirectory = computed(() =>
  policy.value.directory.mode === "fixed" ? policy.value.directory.directory : "",
);

const directoryModeLabel = computed(() => {
  const value = directoryMode.value;
  const map: Record<OutputPolicy["directory"]["mode"], string> = {
    sameAsInput: t("outputPolicy.dir.sameAsInput"),
    fixed: t("outputPolicy.dir.fixed"),
  };
  return map[value] ?? "";
});

const regexPatternInput = ref("");
const regexReplacementInput = ref("");

watch(
  () => policy.value.filename.regexReplace,
  (v) => {
    const nextPattern = v?.pattern ?? "";
    const nextReplacement = v?.replacement ?? "";
    if (regexPatternInput.value !== nextPattern) regexPatternInput.value = nextPattern;
    if (regexReplacementInput.value !== nextReplacement) regexReplacementInput.value = nextReplacement;
  },
  { immediate: true, deep: true },
);

watch([regexPatternInput, regexReplacementInput], () => {
  const pattern = regexPatternInput.value;
  const replacement = regexReplacementInput.value;
  if (!pattern.trim()) {
    if (policy.value.filename.regexReplace) updateFilename({ regexReplace: undefined });
    return;
  }
  updateFilename({ regexReplace: { pattern, replacement } });
});

type PreserveTimesState = { created: boolean; modified: boolean; accessed: boolean };

const normalizePreserveTimes = (value: OutputPolicy["preserveFileTimes"]): PreserveTimesState => {
  if (value === true) return { created: true, modified: true, accessed: true };
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      created: !!record.created,
      modified: !!record.modified,
      accessed: !!record.accessed,
    };
  }
  return { created: false, modified: false, accessed: false };
};

const preserveTimes = computed(() => normalizePreserveTimes(policy.value.preserveFileTimes));

const updatePreserveTimes = (patch: Partial<PreserveTimesState>) => {
  const current = preserveTimes.value;
  const next: PreserveTimesState = { ...current, ...patch };
  const allTrue = next.created && next.modified && next.accessed;
  const allFalse = !next.created && !next.modified && !next.accessed;
  const preserveFileTimes: OutputPolicy["preserveFileTimes"] = allTrue ? true : allFalse ? false : next;
  updatePolicy({ preserveFileTimes });
};

const updateContainerModeFromSelect = (value: unknown) => {
  if (value === "default" || value === "keepInput" || value === "force") {
    updateContainerMode(value);
  }
};

const updateDirectoryModeFromSelect = (value: unknown) => {
  if (value === "sameAsInput" || value === "fixed") {
    updateDirectory(value, fixedDirectory.value);
  }
};

const pickDirectory = async () => {
  if (!hasTauri()) return;
  const selected = await openDialog({ multiple: false, directory: true });
  if (typeof selected === "string" && selected.trim()) {
    updateDirectory("fixed", selected);
  } else if (Array.isArray(selected) && typeof selected[0] === "string") {
    updateDirectory("fixed", selected[0]);
  }
};

const previewInputPath = ref("C:/videos/input.mp4");
const previewResolvedPath = ref<string>("");
const previewError = ref<string | null>(null);
const previewLoading = ref(false);
let previewTimer: number | null = null;

const normalizePathForDisplay = (value: string) => {
  const input = previewInputPath.value;
  const preferForward = input.includes("/") && !input.includes("\\");
  const preferBack = input.includes("\\") && !input.includes("/");
  if (preferForward) return value.replace(/\\/g, "/");
  if (preferBack) return value.replace(/\//g, "\\");
  return value;
};

const effectivePolicyForPreview = computed<OutputPolicy>(() => {
  if (!props.lockLocationAndName) return policy.value;
  return {
    container: policy.value.container,
    directory: { mode: "sameAsInput" },
    filename: { suffix: ".compressed" },
    preserveFileTimes: policy.value.preserveFileTimes,
  };
});

const computeLocalPreview = () => previewOutputPathLocal(previewInputPath.value, effectivePolicyForPreview.value);

const refreshPreview = () => {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    previewError.value = null;
    const fallback = computeLocalPreview();
    previewResolvedPath.value = normalizePathForDisplay(fallback);

    if (!hasTauri()) return;
    const inputPath = previewInputPath.value.trim();
    if (!inputPath) return;

    previewLoading.value = true;
    try {
      const resolved = await previewOutputPath({
        inputPath,
        presetId: props.previewPresetId?.trim() ? props.previewPresetId : null,
        outputPolicy: effectivePolicyForPreview.value,
      });
      if (resolved) previewResolvedPath.value = normalizePathForDisplay(resolved);
    } catch (err: unknown) {
      previewError.value = err instanceof Error ? err.message : String(err ?? "preview failed");
    } finally {
      previewLoading.value = false;
    }
  }, 250);
};

watch(() => [previewInputPath.value, props.previewPresetId, effectivePolicyForPreview.value], refreshPreview, {
  immediate: true,
  deep: true,
});

onBeforeUnmount(() => {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = null;
});

const pickPreviewFile = async () => {
  if (!hasTauri()) return;
  const selected = await openDialog({ multiple: false, directory: false });
  if (typeof selected === "string" && selected.trim()) {
    previewInputPath.value = selected;
  } else if (Array.isArray(selected) && typeof selected[0] === "string") {
    previewInputPath.value = selected[0];
  }
};
</script>

<template>
  <section class="space-y-3">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <Label class="text-xs">{{ t("outputPolicy.containerLabel") }}</Label>
        <div class="flex items-center gap-2">
          <Select :model-value="containerMode" @update:model-value="updateContainerModeFromSelect">
            <SelectTrigger class="h-8 text-xs" data-testid="output-policy-container-mode-trigger">
              <SelectValue>{{ containerModeLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{{ t("outputPolicy.container.default") }}</SelectItem>
              <SelectItem value="keepInput">{{ t("outputPolicy.container.keepInput") }}</SelectItem>
              <SelectItem value="force">{{ t("outputPolicy.container.force") }}</SelectItem>
            </SelectContent>
          </Select>

          <FormatSelect
            v-if="containerMode === 'force'"
            :model-value="forcedContainerFormat"
            :entries="queueOutputContainerEntries"
            :placeholder="t('formatSelect.placeholder') as string"
            @update:model-value="(v) => updatePolicy({ container: { mode: 'force', format: String(v) } })"
          />
        </div>
      </div>

      <div v-if="!props.lockLocationAndName" class="space-y-1.5">
        <Label class="text-xs">{{ t("outputPolicy.dirLabel") }}</Label>
        <div class="flex items-center gap-2">
          <Select :model-value="directoryMode" @update:model-value="updateDirectoryModeFromSelect">
            <SelectTrigger class="h-8 text-xs" data-testid="output-policy-directory-mode-trigger">
              <SelectValue>{{ directoryModeLabel }}</SelectValue>
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

    <div v-if="!props.lockLocationAndName" class="space-y-2">
      <Label class="text-xs">{{ t("outputPolicy.nameLabel") }}</Label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
        <div class="rounded-md border border-border/60 bg-background/60 p-3 space-y-3 h-full">
          <div class="space-y-1">
            <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.name.prefix") }}</Label>
            <Input
              class="h-8 text-xs"
              :model-value="policy.filename.prefix || ''"
              @update:model-value="(v) => updateFilename({ prefix: String(v) || undefined })"
            />
          </div>

          <div class="space-y-2">
            <div class="space-y-0.5">
              <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.regexLabel") }}</Label>
              <p class="text-[10px] text-muted-foreground">
                {{ t("outputPolicy.regex.hint") }}
              </p>
            </div>

            <div class="grid grid-cols-1 gap-2">
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.regex.pattern") }}</Label>
                <Input v-model="regexPatternInput" class="h-8 text-xs font-mono" />
              </div>
              <div class="space-y-1">
                <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.regex.replacement") }}</Label>
                <Input v-model="regexReplacementInput" class="h-8 text-xs font-mono" />
              </div>
            </div>
          </div>
        </div>

        <OutputAppendOrderEditor :filename="policy.filename" @update="updateFilename" />
      </div>
    </div>

    <div class="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <Label class="text-xs">{{ t("outputPolicy.previewLabel") }}</Label>
        <span v-if="previewLoading" class="text-[10px] text-muted-foreground">
          {{ t("outputPolicy.preview.loading") }}
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div class="space-y-1">
          <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.preview.input") }}</Label>
          <div class="flex items-center gap-2">
            <Input v-model="previewInputPath" class="h-8 text-xs font-mono" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 px-2 text-xs shrink-0"
              :disabled="!hasTauri()"
              @click="pickPreviewFile"
            >
              {{ t("outputPolicy.preview.pick") }}
            </Button>
          </div>
        </div>

        <div class="space-y-1">
          <Label class="text-[10px] text-muted-foreground">{{ t("outputPolicy.preview.output") }}</Label>
          <div
            class="min-h-8 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs font-mono whitespace-normal break-all"
            :title="previewResolvedPath"
          >
            {{ previewResolvedPath || "-" }}
          </div>
          <p v-if="previewError" class="text-[10px] text-destructive">
            {{ previewError }}
          </p>
        </div>
      </div>

      <p v-if="props.lockLocationAndName" class="text-[10px] text-muted-foreground">
        {{ t("outputPolicy.preview.lockHint") }}
      </p>
    </div>

    <div class="space-y-2">
      <Label class="text-xs">{{ t("outputPolicy.preserveTimes") }}</Label>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div class="flex items-center gap-2">
          <Checkbox :checked="preserveTimes.created" @update:checked="(v) => updatePreserveTimes({ created: !!v })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.preserveTimesCreated") }}</span>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox :checked="preserveTimes.modified" @update:checked="(v) => updatePreserveTimes({ modified: !!v })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.preserveTimesModified") }}</span>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox :checked="preserveTimes.accessed" @update:checked="(v) => updatePreserveTimes({ accessed: !!v })" />
          <span class="text-xs text-foreground">{{ t("outputPolicy.preserveTimesAccessed") }}</span>
        </div>
      </div>
    </div>

    <p v-if="props.lockLocationAndName" class="text-[10px] text-muted-foreground">
      {{ t("outputPolicy.batchCompressLockHint") }}
    </p>
  </section>
</template>
