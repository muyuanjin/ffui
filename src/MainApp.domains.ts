import { inject, provide, type InjectionKey } from "vue";
import type {
  DialogsDomain,
  MainAppDomains,
  MediaDomain,
  PresetsDomain,
  PreviewDomain,
  QueueDomain,
  SettingsDomain,
  ShellDomain,
} from "./MainApp.types";

const SHELL_DOMAIN_KEY: InjectionKey<ShellDomain> = Symbol("ShellDomain");
const DIALOGS_DOMAIN_KEY: InjectionKey<DialogsDomain> = Symbol("DialogsDomain");
const QUEUE_DOMAIN_KEY: InjectionKey<QueueDomain> = Symbol("QueueDomain");
const PRESETS_DOMAIN_KEY: InjectionKey<PresetsDomain> = Symbol("PresetsDomain");
const SETTINGS_DOMAIN_KEY: InjectionKey<SettingsDomain> = Symbol("SettingsDomain");
const MEDIA_DOMAIN_KEY: InjectionKey<MediaDomain> = Symbol("MediaDomain");
const PREVIEW_DOMAIN_KEY: InjectionKey<PreviewDomain> = Symbol("PreviewDomain");

function injectRequiredDomain<T>(key: InjectionKey<T>, label: string): T {
  const domain = inject(key, null);
  if (!domain) throw new Error(`${label} is not provided`);
  return domain;
}

export function provideMainAppDomains(domains: MainAppDomains) {
  provide(SHELL_DOMAIN_KEY, domains.shell);
  provide(DIALOGS_DOMAIN_KEY, domains.dialogs);
  provide(QUEUE_DOMAIN_KEY, domains.queue);
  provide(PRESETS_DOMAIN_KEY, domains.presetsModule);
  provide(SETTINGS_DOMAIN_KEY, domains.settings);
  provide(MEDIA_DOMAIN_KEY, domains.media);
  provide(PREVIEW_DOMAIN_KEY, domains.preview);
}

export function useShellDomain(): ShellDomain {
  return injectRequiredDomain(SHELL_DOMAIN_KEY, "ShellDomain");
}

export function useDialogsDomain(): DialogsDomain {
  return injectRequiredDomain(DIALOGS_DOMAIN_KEY, "DialogsDomain");
}

export function useQueueDomain(): QueueDomain {
  return injectRequiredDomain(QUEUE_DOMAIN_KEY, "QueueDomain");
}

export function usePresetsDomain(): PresetsDomain {
  return injectRequiredDomain(PRESETS_DOMAIN_KEY, "PresetsDomain");
}

export function useSettingsDomain(): SettingsDomain {
  return injectRequiredDomain(SETTINGS_DOMAIN_KEY, "SettingsDomain");
}

export function useMediaDomain(): MediaDomain {
  return injectRequiredDomain(MEDIA_DOMAIN_KEY, "MediaDomain");
}

export function usePreviewDomain(): PreviewDomain {
  return injectRequiredDomain(PREVIEW_DOMAIN_KEY, "PreviewDomain");
}

export type { DialogsDomain, MediaDomain, PresetsDomain, PreviewDomain, QueueDomain, SettingsDomain, ShellDomain };
