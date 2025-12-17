import { ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppLocale } from "@/i18n";
import type { AppSettings } from "@/types";

export interface UseLocalePersistenceOptions {
  appSettings: Ref<AppSettings | null>;
  handleUpdateAppSettings: (next: AppSettings) => void;
}

export function useLocalePersistence(options: UseLocalePersistenceOptions) {
  const { appSettings, handleUpdateAppSettings } = options;
  const { locale } = useI18n();

  const pendingLocale = ref<AppLocale | null>(null);

  const handleLocaleChange = (nextLocale: AppLocale) => {
    const current = appSettings.value;
    if (!current) {
      // Avoid persisting an incomplete AppSettings snapshot before the backend
      // settings.json has been loaded, which could overwrite user settings.
      pendingLocale.value = nextLocale;
      return;
    }

    handleUpdateAppSettings({ ...current, locale: nextLocale });
  };

  watch(
    () => appSettings.value,
    (nextSettings) => {
      const nextLocale = pendingLocale.value;
      if (!nextSettings || !nextLocale) return;
      pendingLocale.value = null;

      if (locale.value !== nextLocale) {
        locale.value = nextLocale;
      }

      handleUpdateAppSettings({ ...nextSettings, locale: nextLocale });
    },
    { flush: "post" },
  );

  return { handleLocaleChange };
}

export default useLocalePersistence;
