import type { AppSettings } from "@/types";
import { isAppLocale, type AppLocale } from "@/i18n";

export type BootstrapLocaleSource = "forced" | "saved" | "plugin-os" | "navigator" | "fallback";

export interface BootstrapAppLocaleResult {
  locale: AppLocale;
  source: BootstrapLocaleSource;
  /**
   * When available (Tauri mode), return the loaded settings snapshot so the app
   * settings composable can reuse it and avoid a duplicate backend call.
   */
  preloadedAppSettings?: AppSettings;
  /** True when we wrote a missing locale into settings. */
  persisted: boolean;
}

export interface BootstrapAppLocaleOptions {
  hasTauri: boolean;
  loadAppSettings?: () => Promise<AppSettings>;
  saveAppSettings?: (settings: AppSettings) => Promise<AppSettings>;
  /** Optional override for tests; should return a BCP-47 locale string or null. */
  getOsLocale?: () => Promise<string | null>;
  /** Optional override for tests. */
  getNavigatorLocales?: () => string[];
  /** Optional override for tests. */
  getSearch?: () => string;
}

export const normalizeToAppLocale = (raw: unknown): AppLocale | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isAppLocale(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  // Any Chinese variant should map to our single Chinese locale.
  if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) {
    return "zh-CN";
  }
  if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) {
    return "en";
  }
  return null;
};

const defaultGetSearch = () => {
  if (typeof window === "undefined") return "";
  return window.location?.search ?? "";
};

const defaultGetNavigatorLocales = (): string[] => {
  if (typeof navigator === "undefined") return [];
  const nav = navigator as any;

  const out: string[] = [];
  if (Array.isArray(nav.languages)) {
    for (const item of nav.languages) {
      if (typeof item === "string" && item.trim()) out.push(item);
    }
  }
  if (typeof nav.language === "string" && nav.language.trim()) {
    out.push(nav.language);
  }
  try {
    const intlLocale = Intl?.DateTimeFormat?.().resolvedOptions?.().locale;
    if (typeof intlLocale === "string" && intlLocale.trim()) out.push(intlLocale);
  } catch {
    // Ignore.
  }
  return out;
};

const defaultGetOsLocale = async (): Promise<string | null> => {
  try {
    const mod = await import("@tauri-apps/plugin-os");
    if (typeof mod.locale !== "function") return null;
    return await mod.locale();
  } catch {
    return null;
  }
};

const readForcedLocale = (options: BootstrapAppLocaleOptions): AppLocale | null => {
  const search = (options.getSearch ?? defaultGetSearch)();
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    const forced = params.get("ffuiLocale");
    return normalizeToAppLocale(forced);
  } catch {
    return null;
  }
};

const resolveFromNavigator = (options: BootstrapAppLocaleOptions): AppLocale | null => {
  const locales = (options.getNavigatorLocales ?? defaultGetNavigatorLocales)();
  for (const candidate of locales) {
    const resolved = normalizeToAppLocale(candidate);
    if (resolved) return resolved;
  }
  return null;
};

export async function bootstrapAppLocale(options: BootstrapAppLocaleOptions): Promise<BootstrapAppLocaleResult> {
  const forced = readForcedLocale(options);
  if (forced) {
    return { locale: forced, source: "forced", persisted: false };
  }

  const loadAppSettings = options.loadAppSettings;
  const saveAppSettings = options.saveAppSettings;
  const getOsLocale = options.getOsLocale ?? defaultGetOsLocale;

  if (options.hasTauri && loadAppSettings) {
    let settings: AppSettings | undefined;
    try {
      settings = await loadAppSettings();
    } catch {
      settings = undefined;
    }

    const saved = normalizeToAppLocale(settings?.locale);
    if (saved) {
      return {
        locale: saved,
        source: "saved",
        preloadedAppSettings: settings,
        persisted: false,
      };
    }

    // No saved locale: prefer OS locale via plugin-os, then fall back to navigator.
    const osLocale = normalizeToAppLocale(await getOsLocale());
    const detected = osLocale ?? resolveFromNavigator(options) ?? "en";

    // Persist once when we have a settings snapshot and a saver.
    if (settings && saveAppSettings) {
      const next: AppSettings = { ...settings, locale: detected };
      try {
        const savedSettings = await saveAppSettings(next);
        return {
          locale: detected,
          source: osLocale ? "plugin-os" : "navigator",
          preloadedAppSettings: savedSettings,
          persisted: true,
        };
      } catch {
        return {
          locale: detected,
          source: osLocale ? "plugin-os" : "navigator",
          preloadedAppSettings: next,
          persisted: true,
        };
      }
    }

    return {
      locale: detected,
      source: osLocale ? "plugin-os" : "navigator",
      preloadedAppSettings: settings,
      persisted: false,
    };
  }

  // Web mode (or no backend available): fall back to navigator hints.
  const nav = resolveFromNavigator(options);
  return {
    locale: nav ?? "en",
    source: nav ? "navigator" : "fallback",
    persisted: false,
  };
}
