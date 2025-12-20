export type DataRootMode = "system" | "portable";

export interface DataRootInfo {
  desiredMode: DataRootMode;
  effectiveMode: DataRootMode;
  dataRoot: string;
  systemRoot: string;
  portableRoot: string;
  fallbackActive: boolean;
  fallbackNoticePending: boolean;
  switchPending: boolean;
}

export interface ConfigBundleExportResult {
  path: string;
  appVersion: string;
  exportedAtMs: number;
  presetCount: number;
}

export interface ConfigBundleImportResult {
  settings: import("./settings").AppSettings;
  presetCount: number;
  schemaVersion: number;
  appVersion: string;
}
