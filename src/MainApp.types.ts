import type { ComputedRef, Ref } from "vue";
import type {
  AppSettings,
  FFmpegPreset,
  PresetSortDirection,
  PresetSortMode,
  PresetViewMode,
  TranscodeJob,
} from "@/types";
import type { UseMainAppQueueReturn } from "@/composables/main-app/useMainAppQueue";
import type { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import type { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import type { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";
import type { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import type { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import type { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import type { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import type { useMainAppUpdater } from "@/composables/main-app/useMainAppUpdater";
import type { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import type { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import type { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import type { useQueueOutputPolicy } from "@/composables/main-app/useQueueOutputPolicy";
import type { useJobLog } from "@/composables";

export type ShellDomain = ReturnType<typeof useMainAppShell> & {
  currentTitle: ComputedRef<string>;
  currentSubtitle: ComputedRef<string>;
};

export type DialogsDomain = ReturnType<typeof useMainAppDialogs> & {
  batchCompress: ReturnType<typeof useMainAppBatchCompress>;
  jobDetailJob: ReturnType<typeof useJobLog>["jobDetailJob"];
  jobDetailLogText: ReturnType<typeof useJobLog>["jobDetailLogText"];
  highlightedLogHtml: ReturnType<typeof useJobLog>["highlightedLogHtml"];
};

export type QueueDomain = UseMainAppQueueReturn & {
  selectionBarPinned: ComputedRef<boolean>;
  setSelectionBarPinned: (pinned: boolean) => void;
  queueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["queueOutputPolicy"];
  setQueueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["setQueueOutputPolicy"];
  queuePanelProps: ReturnType<typeof createQueuePanelProps>;
  queueTotalCount: ComputedRef<number>;
  jobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  completedCount: ComputedRef<number>;
  lastDroppedRoot: Ref<string | null>;
  dnd: ReturnType<typeof useMainAppDnDAndContextMenu>;
  queueContextMenu: ReturnType<typeof useQueueContextMenu>;
};

export type MainAppQueueTabModule = QueueDomain;

export type PresetsDomain = ReturnType<typeof useMainAppPresets> & {
  presets: Ref<FFmpegPreset[]>;
  presetsLoadedFromBackend: Ref<boolean>;
  manualJobPresetId: Ref<string | null>;
  presetSortMode: Ref<PresetSortMode>;
  presetSortDirection: Ref<PresetSortDirection>;
  presetViewMode: Ref<PresetViewMode>;
  presetSelectionBarPinned: ComputedRef<boolean>;
  setPresetSelectionBarPinned: (pinned: boolean) => void;
  handleImportSmartPackConfirmedWithOnboarding: (presetsToImport: FFmpegPreset[]) => Promise<void>;
};

export type SettingsDomain = ReturnType<typeof useMainAppSettings> & {
  updater: ReturnType<typeof useMainAppUpdater>;
  handleUpdateAppSettings: (next: AppSettings) => void;
  ffmpegResolvedPath: ComputedRef<string | null>;
};

export type MediaDomain = ReturnType<typeof useMainAppMedia>;

export type PreviewDomain = ReturnType<typeof useMainAppPreview>;

export interface MainAppDomains {
  shell: ShellDomain;
  dialogs: DialogsDomain;
  presetsModule: PresetsDomain;
  queue: QueueDomain;
  media: MediaDomain;
  preview: PreviewDomain;
  settings: SettingsDomain;
}
