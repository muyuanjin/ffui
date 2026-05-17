import { inject, provide, type InjectionKey } from "vue";
import type { MainAppDomains } from "./MainApp.types";
import { useMainAppDomains } from "@/composables/main-app/context/useMainAppDomains";
import {
  provideMainAppDomains,
  useDialogsDomain,
  useMediaDomain,
  usePresetsDomain,
  usePreviewDomain,
  useQueueDomain,
  useSettingsDomain,
  useShellDomain,
} from "./MainApp.domains";

export type MainAppContext = MainAppDomains;

export function createMainAppContext(): MainAppContext {
  return useMainAppDomains();
}

export const MAIN_APP_CONTEXT_KEY: InjectionKey<MainAppContext> = Symbol("MainAppContext");

export function provideMainAppContext(context: MainAppContext) {
  provideMainAppDomains(context);
  provide(MAIN_APP_CONTEXT_KEY, context);
}

export function useMainAppContext(): MainAppContext {
  const context = inject(MAIN_APP_CONTEXT_KEY, null);
  if (context) return context;

  return {
    shell: useShellDomain(),
    dialogs: useDialogsDomain(),
    presetsModule: usePresetsDomain(),
    queue: useQueueDomain(),
    media: useMediaDomain(),
    preview: usePreviewDomain(),
    settings: useSettingsDomain(),
  };
}

export type {
  DialogsDomain,
  MediaDomain,
  PresetsDomain,
  PreviewDomain,
  QueueDomain,
  SettingsDomain,
  ShellDomain,
} from "./MainApp.domains";
export {
  useDialogsDomain,
  useMediaDomain,
  usePresetsDomain,
  usePreviewDomain,
  useQueueDomain,
  useSettingsDomain,
  useShellDomain,
} from "./MainApp.domains";
