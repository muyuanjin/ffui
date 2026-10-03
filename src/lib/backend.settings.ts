import type { AppSettings } from "@/types";
import { assertCanonicalInvokePayload, invokeCommand } from "./backend/invokeCommand";

export interface UnavailableSetting {
  path: string;
  reason: string;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  contentId: string;
  dataRootId: string;
  unavailableSettings: UnavailableSetting[];
}

let confirmedSnapshot: SettingsSnapshot | null = null;
let operationTail: Promise<unknown> = Promise.resolve();
let replacementRevision = 0;
const replacementListeners = new Set<(settings: AppSettings) => void>();

export function withSettingsOperation<Value>(operation: () => Promise<Value>): Promise<Value> {
  const pending = operationTail.then(operation);
  operationTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

export function subscribeSettingsReplacement(listener: (settings: AppSettings) => void): () => void {
  replacementListeners.add(listener);
  return () => replacementListeners.delete(listener);
}

export function acceptSettingsReplacement(snapshot: SettingsSnapshot): AppSettings {
  const settings = acceptSettingsSnapshot(snapshot);
  replacementRevision += 1;
  for (const listener of replacementListeners) listener(JSON.parse(JSON.stringify(settings)) as AppSettings);
  return settings;
}

export function acceptSettingsSnapshot(snapshot: SettingsSnapshot): AppSettings {
  if (
    !snapshot ||
    typeof snapshot.contentId !== "string" ||
    !snapshot.contentId ||
    typeof snapshot.dataRootId !== "string" ||
    !snapshot.dataRootId ||
    !snapshot.settings ||
    typeof snapshot.settings !== "object" ||
    Array.isArray(snapshot.settings) ||
    !snapshot.settings.tools ||
    typeof snapshot.settings.tools !== "object" ||
    Array.isArray(snapshot.settings.tools) ||
    !Array.isArray(snapshot.unavailableSettings) ||
    snapshot.unavailableSettings.some(
      (entry) => !entry || typeof entry.path !== "string" || typeof entry.reason !== "string",
    )
  ) {
    throw new Error("Invalid settings snapshot returned by the backend.");
  }
  assertCanonicalInvokePayload({ settings: snapshot.settings });
  confirmedSnapshot = JSON.parse(JSON.stringify(snapshot)) as SettingsSnapshot;
  return snapshot.settings;
}

export const settingsAvailability = (): UnavailableSetting[] =>
  confirmedSnapshot?.unavailableSettings.map((entry) => ({ ...entry })) ?? [];

export const loadAppSettings = async (): Promise<AppSettings> => {
  return withSettingsOperation(async () => {
    const snapshot = await invokeCommand<SettingsSnapshot>("get_app_settings");
    return acceptSettingsSnapshot(snapshot);
  });
};

export const saveAppSettings = async (settings: AppSettings): Promise<AppSettings> => {
  if (!confirmedSnapshot) await loadAppSettings();
  const baseline = confirmedSnapshot!;
  const revision = replacementRevision;
  const candidate = JSON.parse(JSON.stringify(settings)) as AppSettings;
  for (const key of ["downloaded", "remoteVersionCache", "probeCache"]) {
    Reflect.set(candidate.tools, key, Reflect.get(baseline.settings.tools, key));
  }
  return withSettingsOperation(async () => {
    if (revision !== replacementRevision) return JSON.parse(JSON.stringify(confirmedSnapshot!.settings)) as AppSettings;
    const snapshot = await invokeCommand<SettingsSnapshot>("save_app_settings", {
      settings: candidate,
      baseSettings: baseline.settings,
      baseContentId: baseline.contentId,
      dataRootId: baseline.dataRootId,
    });
    return acceptSettingsSnapshot(snapshot);
  });
};
