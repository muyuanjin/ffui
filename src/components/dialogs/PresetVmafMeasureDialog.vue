<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import type { FFmpegPreset } from "@/types";
import { downloadVmafSampleVideo, hasTauri, measurePresetVmaf } from "@/lib/backend";

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

const selectedIds = ref<Set<string>>(new Set());
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void (async () => {
      await props.ensureAppSettingsLoaded();
      referencePath.value = String(props.vmafMeasureReferencePath ?? "").trim();
      statusText.value = "";

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
  try {
    const ids = Array.from(selectedIds.value);
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      statusText.value = t("presets.vmafMeasureRunningProgress", { n: i + 1, total: ids.length }) as string;
      await measurePresetVmaf(id, refPath, { trimSeconds: normalizedTrimSeconds.value });
      await props.reloadPresets();
    }
    statusText.value = t("presets.vmafMeasureDone") as string;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e ?? "Unknown error");
    statusText.value = `${t("presets.vmafMeasureFailed")}: ${message}`;
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
      <DialogHeader class="pb-2">
        <DialogTitle>{{ t("presets.vmafMeasureTitle") }}</DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          {{ t("presets.vmafMeasureDescription") }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
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

        <div v-if="statusText" class="text-[11px] text-muted-foreground break-all">
          {{ statusText }}
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
