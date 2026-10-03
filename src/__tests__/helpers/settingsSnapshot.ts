import type { AppSettings } from "@/types";
import type { SettingsSnapshot } from "@/lib/backend.settings";

export const settingsSnapshot = (settings: AppSettings): SettingsSnapshot => ({
  settings: JSON.parse(JSON.stringify(settings)) as AppSettings,
  contentId: JSON.stringify(settings),
  dataRootId: "test-data-root",
  unavailableSettings: [],
});

export function settingsCommandResponse(command: string, value: unknown): unknown {
  if (
    (command === "get_app_settings" || command === "save_app_settings") &&
    value &&
    typeof value === "object" &&
    "tools" in value
  ) {
    return settingsSnapshot(value as AppSettings);
  }
  return value;
}
