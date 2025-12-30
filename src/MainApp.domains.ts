import { useMainAppContext, type MainAppContext } from "./MainApp.setup";

export type ShellDomain = MainAppContext["shell"];
export type DialogsDomain = MainAppContext["dialogs"];
export type QueueDomain = MainAppContext["queue"];
export type PresetsDomain = MainAppContext["presetsModule"];
export type SettingsDomain = MainAppContext["settings"];
export type MediaDomain = MainAppContext["media"];
export type PreviewDomain = MainAppContext["preview"];

export function useShellDomain(): ShellDomain {
  return useMainAppContext().shell;
}

export function useDialogsDomain(): DialogsDomain {
  return useMainAppContext().dialogs;
}

export function useQueueDomain(): QueueDomain {
  return useMainAppContext().queue;
}

export function usePresetsDomain(): PresetsDomain {
  return useMainAppContext().presetsModule;
}

export function useSettingsDomain(): SettingsDomain {
  return useMainAppContext().settings;
}

export function useMediaDomain(): MediaDomain {
  return useMainAppContext().media;
}

export function usePreviewDomain(): PreviewDomain {
  return useMainAppContext().preview;
}
