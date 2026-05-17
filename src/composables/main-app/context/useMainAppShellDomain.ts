import { computed } from "vue";
import type { ShellDomain } from "@/MainApp.types";
import { useMainAppShell } from "@/composables/main-app/useMainAppShell";
import type { MainAppSharedState } from "./useMainAppSharedState";

type Translate = MainAppSharedState["t"];

export function useMainAppShellDomain(t: Translate): ShellDomain {
  const shell = useMainAppShell();
  const titleForTab = {
    queue: () => t("app.tabs.queue"),
    presets: () => t("app.tabs.presets"),
    media: () => t("app.tabs.media"),
    monitor: () => t("app.tabs.monitor"),
    settings: () => t("app.tabs.settings"),
  } as const;
  const subtitleForTab = {
    queue: () => t("app.queueHint"),
    presets: () => t("app.presetsHint"),
    media: () => t("app.mediaHint"),
    monitor: () => t("app.monitorHint"),
    settings: () => t("app.settingsHint"),
  } as const;
  const currentTitle = computed(() => titleForTab[shell.activeTab.value]?.() ?? titleForTab.queue());
  const currentSubtitle = computed(() => subtitleForTab[shell.activeTab.value]?.() ?? "");

  return {
    ...shell,
    currentTitle,
    currentSubtitle,
  };
}
