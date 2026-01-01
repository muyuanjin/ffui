<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress, type ProgressVariant } from "@/components/ui/progress";
import type { FFmpegPreset } from "@/types";
import { downloadVmafSampleVideo, hasTauri, measurePresetVmaf } from "@/lib/backend";
import { parseVmafMeasureError, type ParsedVmafMeasureError } from "@/lib/vmafMeasureError";
import PresetVmafMeasureAboutPanel from "./PresetVmafMeasureAboutPanel.vue";

const props = defineProps<{
  open: boolean;
  presets: FFmpegPreset[];
  reloadPresets: () => Promise<void>;
  vmafMeasureReferencePath: string;
  setVmafMeasureReferencePath: (path: string) => void;
  ensureAppSettingsLoaded: () => Promise<void>;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const { t } = useI18n();

const referencePath = ref<string>("");
const trimSecondsText = ref<string>("30");
const busy = ref<boolean>(false);
const statusText = ref<string>("");
const runTotal = ref<number>(0);
const runDone = ref<number>(0);
const runFailed = ref<boolean>(false);
const runError = ref<ParsedVmafMeasureError | null>(null);
const runErrorDetailsOpen = ref<boolean>(false);

const selectedIds = ref<Set<string>>(new Set());
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void (async () => {
      await props.ensureAppSettingsLoaded();
      referencePath.value = String(props.vmafMeasureReferencePath ?? "").trim();
      statusText.value = "";
      runTotal.value = 0;
      runDone.value = 0;
      runFailed.value = false;
      runError.value = null;
      runErrorDetailsOpen.value = false;

      // Default selection: "smart" presets when available; otherwise select all.
      const smart = props.presets.filter((p) => p.isSmartPreset === true).map((p) => p.id);
      selectedIds.value = new Set(smart.length > 0 ? smart : props.presets.map((p) => p.id));
    })();
  },
  { immediate: true },
);

const selectedCount = computed(() => selectedIds.value.size);

watch(
  referencePath,
  (next) => {
    props.setVmafMeasureReferencePath(next);
  },
  { flush: "post" },
);

const setSelected = (id: string, on: boolean) => {
  const next = new Set(selectedIds.value);
  if (on) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
};

const toggleAll = (next: boolean) => {
  selectedIds.value = new Set(next ? props.presets.map((p) => p.id) : []);
};
const toggleSmartOnly = () => {
  selectedIds.value = new Set(props.presets.filter((p) => p.isSmartPreset === true).map((p) => p.id));
};

const normalizedTrimSeconds = computed(() => {
  const raw = Number(trimSecondsText.value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
});

const runProgressPercent = computed(() => {
  const total = runTotal.value;
  if (!Number.isFinite(total) || total <= 0) return 0;
  const done = runDone.value;
  const clamped = Math.max(0, Math.min(done, total));
  return Math.round((clamped / total) * 100);
});

const runProgressVariant = computed<ProgressVariant>(() => {
  if (runFailed.value) return "error";
  if (runTotal.value > 0 && runDone.value >= runTotal.value && !busy.value) return "success";
  return "default";
});

const showRunProgress = computed(() => runTotal.value > 0);

const runErrorUi = computed(() => {
  if (!runError.value) return null;
  const err = runError.value;
  if (err.kind === "missing_encoder") {
    const lines: string[] = [];
    lines.push(t("presets.vmafMeasureErrorMissingEncoderLine1", { encoder: err.encoder }) as string);
    if (err.presetId) {
      lines.push(t("presets.vmafMeasureErrorMissingEncoderLinePreset", { presetId: err.presetId }) as string);
    }
    if (err.ffmpegPath) {
      lines.push(t("presets.vmafMeasureErrorMissingEncoderLineFfmpeg", { ffmpegPath: err.ffmpegPath }) as string);
    }
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: lines.join("\n"),
      actions: [
        t("presets.vmafMeasureErrorActionSwitchFfmpeg") as string,
        t("presets.vmafMeasureErrorActionUnselectPreset") as string,
      ],
      details: err.raw,
    };
  }
  if (err.kind === "missing_filter") {
    const lines: string[] = [];
    if (err.filter === "libvmaf") {
      lines.push(t("presets.vmafMeasureErrorMissingFilterLine1", { filter: err.filter }) as string);
    } else {
      lines.push(t("presets.vmafMeasureErrorMissingFilterGenericLine1", { filter: err.filter }) as string);
    }
    if (err.ffmpegPath) {
      lines.push(t("presets.vmafMeasureErrorMissingEncoderLineFfmpeg", { ffmpegPath: err.ffmpegPath }) as string);
    }
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: lines.join("\n"),
      actions: [
        err.filter === "libvmaf"
          ? (t("presets.vmafMeasureErrorActionSwitchFfmpegWithVmaf") as string)
          : (t("presets.vmafMeasureErrorActionSwitchFfmpeg") as string),
      ],
      details: err.raw,
    };
  }
  if (err.kind === "missing_decoder") {
    const lines: string[] = [];
    lines.push(t("presets.vmafMeasureErrorMissingDecoderLine1", { decoder: err.decoder }) as string);
    if (err.ffmpegPath) {
      lines.push(t("presets.vmafMeasureErrorMissingEncoderLineFfmpeg", { ffmpegPath: err.ffmpegPath }) as string);
    }
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: lines.join("\n"),
      actions: [t("presets.vmafMeasureErrorActionSwitchFfmpeg") as string],
      details: err.raw,
    };
  }
  if (err.kind === "missing_library") {
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: t("presets.vmafMeasureErrorMissingLibraryLine1", { library: err.library }) as string,
      actions: [t("presets.vmafMeasureErrorActionSwitchFfmpeg") as string],
      details: err.raw,
    };
  }
  if (err.kind === "input_not_found") {
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: t("presets.vmafMeasureErrorInputNotFound") as string,
      actions: [t("presets.vmafMeasureErrorActionCheckPaths") as string],
      details: err.raw,
    };
  }
  if (err.kind === "permission_denied") {
    return {
      title: t("presets.vmafMeasureFailed") as string,
      summary: t("presets.vmafMeasureErrorPermissionDenied") as string,
      actions: [t("presets.vmafMeasureErrorActionCheckPaths") as string],
      details: err.raw,
    };
  }
  return {
    title: t("presets.vmafMeasureFailed") as string,
    summary: t("presets.vmafMeasureErrorUnknown") as string,
    actions: [t("presets.vmafMeasureErrorActionCheckDetails") as string],
    details: err.raw,
  };
});

const pickVideo = async () => {
  if (!hasTauri()) return;
  const picked = await openDialog({
    multiple: false,
    directory: false,
    title: t("presets.vmafMeasurePickTitle"),
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "webm", "ts", "m2ts"] }],
  });
  if (typeof picked === "string" && picked.trim()) {
    referencePath.value = picked.trim();
  }
};

const downloadSample = async () => {
  if (!hasTauri()) return;
  busy.value = true;
  statusText.value = t("presets.vmafMeasureDownloadingSample") as string;
  try {
    const path = await downloadVmafSampleVideo("bbb1080p30s");
    referencePath.value = path;
    statusText.value = t("presets.vmafMeasureSampleReady") as string;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? "Unknown error");
    statusText.value = `${t("presets.vmafMeasureFailed")}: ${message}`;
  } finally {
    busy.value = false;
  }
};

const run = async () => {
  if (!hasTauri()) return;
  const refPath = referencePath.value.trim();
  if (!refPath) return;
  if (selectedIds.value.size === 0) return;

  busy.value = true;
  runFailed.value = false;
  runError.value = null;
  runErrorDetailsOpen.value = false;
  try {
    const ids = Array.from(selectedIds.value);
    runTotal.value = ids.length;
    runDone.value = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      statusText.value = t("presets.vmafMeasureRunningProgress", { n: i + 1, total: ids.length }) as string;
      await measurePresetVmaf(id, refPath, { trimSeconds: normalizedTrimSeconds.value });
      await props.reloadPresets();
      runDone.value = i + 1;
    }
    statusText.value = t("presets.vmafMeasureDone") as string;
  } catch (e) {
    runFailed.value = true;
    const message = e instanceof Error ? e.message : String(e ?? "Unknown error");
    statusText.value = t("presets.vmafMeasureFailed") as string;
    runError.value = parseVmafMeasureError(message);
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent
      :portal-disabled="true"
      :portal-force-mount="true"
      class="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
    >
      <DialogHeader class="pb-2">
        <DialogTitle>{{ t("presets.vmafMeasureTitle") }}</DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          {{ t("presets.vmafMeasureDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        <PresetVmafMeasureAboutPanel :dialog-open="props.open" />

        <div class="rounded-md border border-border/50 bg-card/50 p-3 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[11px] font-medium">{{ t("presets.vmafMeasureVideoLabel") }}</div>
            <div class="flex items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                class="h-7 px-2"
                :disabled="busy || !hasTauri()"
                @click="downloadSample"
              >
                {{ t("presets.vmafMeasureDownloadSample") }}
              </Button>
              <Button size="xs" variant="outline" class="h-7 px-2" :disabled="busy || !hasTauri()" @click="pickVideo">
                {{ t("presets.vmafMeasurePickVideo") }}
              </Button>
            </div>
          </div>
          <input
            v-model="referencePath"
            class="h-7 w-full rounded border border-border bg-background px-2 text-[11px]"
            :placeholder="t('presets.vmafMeasureNoVideo')"
            :disabled="busy || !hasTauri()"
            spellcheck="false"
          />
          <div class="flex items-center gap-2">
            <label class="text-[11px] text-muted-foreground">{{ t("presets.vmafMeasureTrimSeconds") }}</label>
            <input
              v-model="trimSecondsText"
              class="h-7 w-24 rounded border border-border bg-background px-2 text-[11px]"
              inputmode="decimal"
            />
            <span class="text-[11px] text-muted-foreground">{{ t("presets.vmafMeasureTrimHint") }}</span>
          </div>
        </div>

        <div class="rounded-md border border-border/50 bg-card/50 p-3 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[11px] font-medium">
              {{ t("presets.vmafMeasurePresetsLabel", { count: selectedCount }) }}
            </div>
            <div class="flex items-center gap-2">
              <Button size="xs" variant="outline" class="h-7 px-2" :disabled="busy" @click="toggleSmartOnly">
                {{ t("presets.vmafMeasureSelectSmart") }}
              </Button>
              <Button size="xs" variant="outline" class="h-7 px-2" :disabled="busy" @click="toggleAll(true)">
                {{ t("presets.vmafMeasureSelectAll") }}
              </Button>
              <Button size="xs" variant="outline" class="h-7 px-2" :disabled="busy" @click="toggleAll(false)">
                {{ t("presets.vmafMeasureSelectNone") }}
              </Button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-1">
            <label
              v-for="p in props.presets"
              :key="p.id"
              class="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/20 cursor-pointer"
            >
              <Checkbox
                :checked="selectedIds.has(p.id)"
                :disabled="busy"
                @update:checked="(v: boolean | 'indeterminate' | null | undefined) => setSelected(p.id, v === true)"
              />
              <span class="text-[11px] text-foreground truncate">{{ p.name }}</span>
              <span class="text-[10px] text-muted-foreground truncate">({{ p.video.encoder }})</span>
            </label>
          </div>
        </div>

        <div v-if="statusText || showRunProgress || runErrorUi" class="space-y-2">
          <div v-if="statusText" class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
            {{ statusText }}
          </div>
          <Progress
            v-if="showRunProgress"
            :model-value="runProgressPercent"
            :variant="runProgressVariant"
            class="relative z-10"
            data-testid="preset-vmaf-measure-progress-bar"
          />

          <div v-if="runErrorUi" class="rounded-md border border-border/50 bg-card/50 p-3 space-y-2">
            <div class="text-[11px] font-medium text-destructive">{{ runErrorUi.title }}</div>
            <div class="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed select-text">
              {{ runErrorUi.summary }}
            </div>
            <ul v-if="runErrorUi.actions.length > 0" class="list-disc pl-5 space-y-1">
              <li
                v-for="(a, i) in runErrorUi.actions"
                :key="i"
                class="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed"
              >
                {{ a }}
              </li>
            </ul>
            <button
              type="button"
              class="w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-accent/20"
              :aria-expanded="runErrorDetailsOpen"
              aria-controls="preset-vmaf-measure-error-details"
              @click="runErrorDetailsOpen = !runErrorDetailsOpen"
            >
              <span class="text-[11px] font-medium text-foreground">
                {{
                  runErrorDetailsOpen
                    ? t("presets.vmafMeasureErrorHideDetails")
                    : t("presets.vmafMeasureErrorShowDetails")
                }}
              </span>
              <ChevronDown
                class="h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
                :class="runErrorDetailsOpen ? 'rotate-180' : ''"
              />
            </button>
            <div
              id="preset-vmaf-measure-error-details"
              class="grid px-2 transition-[grid-template-rows,opacity,padding-bottom] duration-200 ease-in-out motion-reduce:transition-none"
              :class="runErrorDetailsOpen ? 'grid-rows-[1fr] opacity-100 pb-2' : 'grid-rows-[0fr] opacity-0 pb-0'"
            >
              <pre
                class="overflow-hidden text-[10px] text-muted-foreground whitespace-pre-wrap break-words select-text"
                >{{ runErrorUi.details }}</pre
              >
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="pt-2">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">
          {{ t("app.actions.close") }}
        </Button>
        <Button :disabled="busy || !hasTauri() || !referencePath.trim() || selectedIds.size === 0" @click="run">
          {{ t("presets.vmafMeasureRun") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
