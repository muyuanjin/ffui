import { createI18n } from "vue-i18n";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export type AppLocale = "en" | "zh-CN";

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export const isAppLocale = (value: unknown): value is AppLocale => {
  return value === "en" || value === "zh-CN";
};

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: "en",
  // 直接内联多语言文案，避免首屏再触发额外的动态加载。
  messages: {
    en,
    "zh-CN": zhCN,
  },
}) as any;

export function loadLocale(locale: AppLocale) {
  i18n.global.locale.value = locale as any;
}
