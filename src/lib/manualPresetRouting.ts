import type { FFmpegPreset, QueuePresetSelection } from "@/types";
import { outputMediaKindForExtension } from "@/lib/outputContainerPolicy";
import { enqueueTranscodeJob, enqueueTranscodeJobs } from "@/lib/backend";

export const DEFAULT_QUEUE_PRESET_SELECTION: QueuePresetSelection = { mode: "unified" };

export function planManualPresetGroups(
  files: string[],
  presets: FFmpegPreset[],
  unifiedPresetId: string | null,
  selection: QueuePresetSelection,
): Array<{ presetId: string; filenames: string[] }> {
  const groups: Array<{ presetId: string; filenames: string[] }> = [];
  for (const filename of files) {
    const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "";
    const extension = basename.includes(".") ? basename.split(".").pop()! : "";
    const kind = outputMediaKindForExtension(extension);
    const configured = selection.mode === "byMedia" && kind ? selection[kind] : undefined;
    const presetId = configured ?? unifiedPresetId ?? presets[0]?.id;
    if (!presetId || !presets.some((preset) => preset.id === presetId)) {
      throw new Error(`No preset found for ${filename}: ${presetId ?? "(unset)"}`);
    }
    const group = groups[groups.length - 1];
    if (group?.presetId === presetId) {
      group.filenames.push(filename);
    } else {
      groups.push({ presetId, filenames: [filename] });
    }
  }
  return groups;
}

export async function enqueueManualPresetFiles(
  files: string[],
  presets: FFmpegPreset[],
  unifiedPresetId: string | null,
  selection: QueuePresetSelection = DEFAULT_QUEUE_PRESET_SELECTION,
  prepareEnqueue?: () => Promise<void>,
) {
  const groups = planManualPresetGroups(files, presets, unifiedPresetId, selection);
  for (const { presetId, filenames } of groups) {
    await prepareEnqueue?.();
    const request = { jobType: "other" as const, source: "manual" as const, originalSizeMb: 0, presetId };
    if (filenames.length === 1) {
      await enqueueTranscodeJob({ ...request, filename: filenames[0] });
    } else {
      await enqueueTranscodeJobs({ ...request, filenames });
    }
  }
}
