import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

export type AppLocale = "en" | "zh-CN";

const resolveInitialLocale = (): AppLocale => {
  if (typeof window === "undefined") return "zh-CN";
  try {
    const params = new URLSearchParams(window.location.search);
    const forced = params.get("ffuiLocale");
    if (forced === "en" || forced === "zh-CN") return forced;
  } catch {
    // Ignore.
  }
  return "zh-CN";
};

export const DEFAULT_LOCALE: AppLocale = resolveInitialLocale();

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: "en",
  // Inline all messages to keep the UI deterministic during screenshot capture.
  messages: {
    en,
    "zh-CN": zhCN,
  },
}) as any;

export function loadLocale(locale: AppLocale) {
  i18n.global.locale.value = locale as any;
}
