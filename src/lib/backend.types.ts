export interface OpenSourceFontInfo {
  id: string;
  name: string;
  familyName: string;
  format: string;
}

export interface DownloadedFontInfo {
  id: string;
  familyName: string;
  path: string;
  format: string;
}

export type UiFontDownloadStatus =
  | "starting"
  | "downloading"
  | "ready"
  | "error"
  | "canceled";

export interface UiFontDownloadSnapshot {
  sessionId: number;
  fontId: string;
  status: UiFontDownloadStatus;
  receivedBytes: number;
  totalBytes: number | null;
  familyName: string;
  format: string;
  path: string | null;
  error: string | null;
}

export interface AppUpdaterCapabilities {
  configured: boolean;
}
