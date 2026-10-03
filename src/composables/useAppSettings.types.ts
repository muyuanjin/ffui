import type { Ref } from "vue";
import type {
  AppSettings,
  BatchCompressConfig,
  ExternalToolCandidate,
  ExternalToolKind,
  ExternalToolStatus,
  Translate,
} from "@/types";
import type { UnavailableSetting } from "@/lib/backend.settings";

export interface UseAppSettingsOptions {
  smartConfig?: Ref<BatchCompressConfig>;
  manualJobPresetId?: Ref<string | null>;
  t?: Translate;
}

export interface UseAppSettingsReturn {
  appSettings: Ref<AppSettings | null>;
  isSavingSettings: Ref<boolean>;
  settingsSaveError: Ref<string | null>;
  unavailableSettings: Ref<UnavailableSetting[]>;
  toolStatuses: Ref<ExternalToolStatus[]>;
  toolStatusesFresh: Ref<boolean>;
  ensureAppSettingsLoaded: () => Promise<void>;
  scheduleSaveSettings: () => void;
  persistNow: (nextSettings?: AppSettings) => Promise<void>;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  getAppSetting: <Key extends keyof AppSettings>(key: Key) => AppSettings[Key] | undefined;
  flushSettings: () => Promise<void>;
  markSaved: (serializedOrSettings: string | AppSettings) => void;
  refreshToolStatuses: (options?: {
    remoteCheck?: boolean;
    manualRemoteCheck?: boolean;
    remoteCheckKind?: ExternalToolKind;
  }) => Promise<void>;
  downloadToolNow: (kind: ExternalToolKind) => Promise<void>;
  fetchToolCandidates: (kind: ExternalToolKind) => Promise<ExternalToolCandidate[]>;
  getToolDisplayName: (kind: ExternalToolKind) => string;
  getToolCustomPath: (kind: ExternalToolKind) => string;
  setToolCustomPath: (kind: ExternalToolKind, value: string | number) => void;
  cleanup: () => void;
}
