import type { Ref } from "vue";
import type { FFmpegPreset, QueueViewMode } from "@/types";

export function getQueueIconGridClass(queueViewMode: QueueViewMode): string {
  // Use CSS grid auto-fill so the queue can naturally fill wide windows (e.g. maximized),
  // while still keeping the per-size density stable when there are only a few items.
  //
  // NOTE: The min widths are intentionally spaced out to keep icon-small / icon-medium /
  // icon-large visually distinct across common window sizes.
  if (queueViewMode === "icon-large") {
    return "grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]";
  }
  if (queueViewMode === "icon-medium") {
    return "grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]";
  }
  return "grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]";
}

export function ensureManualPresetId(presets: FFmpegPreset[], manualJobPresetId: Ref<string | null>) {
  if (!presets || presets.length === 0) {
    manualJobPresetId.value = null;
    return;
  }
  if (!manualJobPresetId.value || !presets.some((p) => p.id === manualJobPresetId.value)) {
    manualJobPresetId.value = presets[0].id;
  }
}

export function resolveManualPreset(presets: FFmpegPreset[], manualJobPresetId: string | null): FFmpegPreset | null {
  if (!presets || presets.length === 0) return null;
  if (!manualJobPresetId) return presets[0];
  return presets.find((p) => p.id === manualJobPresetId) ?? presets[0];
}
