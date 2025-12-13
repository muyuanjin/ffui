import { computed, onMounted, ref, watch, type Ref } from "vue";
import type { AppSettings } from "@/types";
import {
  fetchAppUpdaterCapabilities,
  hasTauri,
  saveAppSettings,
} from "@/lib/backend";

export interface UseMainAppUpdaterOptions {
  appSettings: Ref<AppSettings | null>;
  scheduleSaveSettings: () => void;
  /** Optional startup idle gate so update checks can be deferred. */
  startupIdleReady?: Ref<boolean>;
}

const DEFAULT_UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

function isTestEnv(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    typeof import.meta.env !== "undefined" &&
    import.meta.env.MODE === "test"
  );
}

function isDevEnv(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    typeof import.meta.env !== "undefined" &&
    import.meta.env.DEV === true
  );
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function useMainAppUpdater(options: UseMainAppUpdaterOptions) {
  const { appSettings, scheduleSaveSettings, startupIdleReady } = options;

  const isCheckingForUpdate = ref(false);
  const isInstallingUpdate = ref(false);
  const updateCheckError = ref<string | null>(null);

  const updaterConfigured = ref<boolean | null>(null);
  const updateAvailable = ref(false);
  const availableVersion = ref<string | null>(null);
  const currentVersion = ref<string | null>(null);
  const lastCheckedAtMs = ref<number | null>(null);

  const downloadedBytes = ref(0);
  const totalBytes = ref<number | null>(null);

  let updaterCapabilitiesPromise: Promise<void> | null = null;

  const ensureUpdaterCapabilitiesLoaded = async () => {
    if (!hasTauri()) {
      updaterConfigured.value = false;
      return;
    }
    if (updaterConfigured.value !== null) return;
    if (!updaterCapabilitiesPromise) {
      updaterCapabilitiesPromise = (async () => {
        try {
          const caps = await fetchAppUpdaterCapabilities();
          updaterConfigured.value = !!caps?.configured;
        } catch (error) {
          if (!isTestEnv()) {
            console.error("Failed to load app updater capabilities", error);
          }
          updaterConfigured.value = false;
        } finally {
          updaterCapabilitiesPromise = null;
        }
      })();
    }
    await updaterCapabilitiesPromise;
  };

  const autoCheckEnabled = computed<boolean>(() => {
    const raw = (appSettings.value as any)?.updater?.autoCheck;
    const configured = updaterConfigured.value === true;
    const defaultValue = !isDevEnv() && configured;
    return configured && coerceBoolean(raw, defaultValue);
  });

  const autoCheckDefault = computed<boolean>(() => {
    return !isDevEnv() && updaterConfigured.value !== false;
  });

  let updateHandle: any | null = null;
  let autoCheckTriggered = false;

  const persistUpdaterPatch = (patch: Record<string, unknown>) => {
    const current = appSettings.value;
    if (!current) return;
    const existing = (current as any).updater ?? {};
    const nextUpdater = { ...existing, ...patch };
    appSettings.value = { ...(current as any), updater: nextUpdater };
    scheduleSaveSettings();
  };

  const shouldCheckByTtl = () => {
    const settings = appSettings.value;
    if (!settings) return false;
    const raw = (settings as any)?.updater?.lastCheckedAtMs;
    const last = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (!last) return true;
    return Date.now() - last >= DEFAULT_UPDATE_CHECK_TTL_MS;
  };

  const checkForAppUpdate = async (opts?: { force?: boolean }) => {
    if (!hasTauri()) return;
    if (!appSettings.value) return;
    if (isCheckingForUpdate.value || isInstallingUpdate.value) return;
    await ensureUpdaterCapabilitiesLoaded();
    if (updaterConfigured.value !== true) return;

    const force = opts?.force ?? false;
    if (!force) {
      if (!autoCheckEnabled.value) return;
      if (!shouldCheckByTtl()) return;
    }

    isCheckingForUpdate.value = true;
    updateCheckError.value = null;
    downloadedBytes.value = 0;
    totalBytes.value = null;
    updateHandle = null;

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      const now = Date.now();

      lastCheckedAtMs.value = now;

      if (update) {
        updateHandle = update;
        updateAvailable.value = true;
        availableVersion.value = update.version ?? null;
        currentVersion.value = update.currentVersion ?? null;
        persistUpdaterPatch({
          lastCheckedAtMs: now,
          availableVersion: update.version ?? undefined,
        });
      } else {
        updateAvailable.value = false;
        availableVersion.value = null;
        currentVersion.value = null;
        persistUpdaterPatch({
          lastCheckedAtMs: now,
          availableVersion: undefined,
        });
      }
    } catch (error) {
      const now = Date.now();
      updateCheckError.value = String(error ?? "unknown error");
      lastCheckedAtMs.value = now;
      persistUpdaterPatch({ lastCheckedAtMs: now });
    } finally {
      isCheckingForUpdate.value = false;
    }
  };

  const downloadAndInstallUpdate = async () => {
    if (!hasTauri()) return;
    if (isInstallingUpdate.value || isCheckingForUpdate.value) return;
    await ensureUpdaterCapabilitiesLoaded();
    if (updaterConfigured.value !== true) return;

    if (!updateHandle) {
      await checkForAppUpdate({ force: true });
    }

    if (!updateHandle) return;

    isInstallingUpdate.value = true;
    updateCheckError.value = null;
    downloadedBytes.value = 0;
    totalBytes.value = null;

    try {
      await updateHandle.downloadAndInstall((event: any) => {
        const kind = event?.event;
        if (kind === "Started") {
          const len = event?.data?.contentLength;
          totalBytes.value = typeof len === "number" ? len : null;
          downloadedBytes.value = 0;
          return;
        }
        if (kind === "Progress") {
          const chunk = event?.data?.chunkLength;
          if (typeof chunk === "number" && Number.isFinite(chunk)) {
            downloadedBytes.value += chunk;
          }
        }
      });

      if (typeof updateHandle?.close === "function") {
        await updateHandle.close();
      }

      const now = Date.now();
      updateHandle = null;
      updateAvailable.value = false;
      availableVersion.value = null;
      currentVersion.value = null;
      lastCheckedAtMs.value = now;
      downloadedBytes.value = 0;
      totalBytes.value = null;
      persistUpdaterPatch({
        lastCheckedAtMs: now,
        availableVersion: undefined,
      });
      if (appSettings.value) {
        try {
          await saveAppSettings(appSettings.value);
        } catch (error) {
          console.error("Failed to persist updater state before relaunch", error);
        }
      }

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      updateCheckError.value = String(error ?? "unknown error");
    } finally {
      isInstallingUpdate.value = false;
    }
  };

  // Restore cached values from persisted AppSettings so the UI can show the
  // last-known state immediately after settings load.
  const recomputeUpdateAvailable = () => {
    updateAvailable.value =
      updaterConfigured.value === true && !!availableVersion.value;
  };

  watch(
    appSettings,
    (next) => {
      if (!next) return;
      const checkedAt = (next as any)?.updater?.lastCheckedAtMs;
      const available = (next as any)?.updater?.availableVersion;
      lastCheckedAtMs.value = typeof checkedAt === "number" ? checkedAt : null;
      availableVersion.value = typeof available === "string" ? available : null;
      recomputeUpdateAvailable();
    },
    { flush: "post" },
  );

  watch(
    updaterConfigured,
    () => {
      recomputeUpdateAvailable();
    },
    { flush: "post" },
  );

  const canAutoCheckNow = () => {
    if (autoCheckTriggered) return false;
    if (isTestEnv()) return false;
    if (!hasTauri()) return false;
    if (!autoCheckEnabled.value) return false;
    if (startupIdleReady && !startupIdleReady.value) return false;
    if (!appSettings.value) return false;
    return shouldCheckByTtl();
  };

  const maybeAutoCheck = () => {
    if (!canAutoCheckNow()) return;
    autoCheckTriggered = true;
    void checkForAppUpdate({ force: false });
  };

  onMounted(() => {
    void ensureUpdaterCapabilitiesLoaded().finally(() => {
      maybeAutoCheck();
    });
  });

  watch(
    [appSettings, autoCheckEnabled, startupIdleReady ?? ref(true)],
    () => {
      maybeAutoCheck();
    },
    { flush: "post" },
  );

  return {
    isCheckingForUpdate,
    isInstallingUpdate,
    updateCheckError,
    updaterConfigured,
    updateAvailable,
    availableVersion,
    currentVersion,
    lastCheckedAtMs,
    downloadedBytes,
    totalBytes,
    autoCheckEnabled,
    autoCheckDefault,
    checkForAppUpdate,
    downloadAndInstallUpdate,
  };
}

export default useMainAppUpdater;
