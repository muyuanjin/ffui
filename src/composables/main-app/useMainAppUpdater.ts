import { computed, onMounted, ref, watch, type Ref } from "vue";
import type { AppSettings } from "@/types";
import { fetchAppUpdaterCapabilities, hasTauri, prepareAppUpdaterProxy, saveAppSettings } from "@/lib/backend";

export interface UseMainAppUpdaterOptions {
  appSettings: Ref<AppSettings | null>;
  scheduleSaveSettings: () => void;
  /** Optional startup idle gate so update checks can be deferred. */
  startupIdleReady?: Ref<boolean>;
}

const DEFAULT_UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
};

function parseSemver(raw: string): ParsedSemver | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^v/i, "").split("+")[0] ?? "";
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(cleaned);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  const prereleaseRaw = match[4];
  const prerelease = typeof prereleaseRaw === "string" && prereleaseRaw.length > 0 ? prereleaseRaw.split(".") : null;
  return { major, minor, patch, prerelease };
}

function compareSemver(aRaw: string, bRaw: string): number | null {
  const a = parseSemver(aRaw);
  const b = parseSemver(bRaw);
  if (!a || !b) return null;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (!aPre && !bPre) return 0;
  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (!aPre || !bPre) return 0;

  const max = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < max; i++) {
    const ai = aPre[i];
    const bi = bPre[i];
    if (ai == null && bi == null) return 0;
    if (ai == null) return -1;
    if (bi == null) return 1;
    if (ai === bi) continue;

    const aNum = /^\d+$/.test(ai) ? Number(ai) : null;
    const bNum = /^\d+$/.test(bi) ? Number(bi) : null;
    if (aNum != null && bNum != null) return aNum > bNum ? 1 : -1;
    if (aNum != null && bNum == null) return -1;
    if (aNum == null && bNum != null) return 1;
    return ai > bi ? 1 : -1;
  }
  return 0;
}

function isTestEnv(): boolean {
  return (
    typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test"
  );
}

function isDevEnv(): boolean {
  return typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.DEV === true;
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
  const availableBody = ref<string | null>(null);
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

  let currentVersionPromise: Promise<void> | null = null;

  const ensureCurrentVersionLoaded = async () => {
    if (!hasTauri()) return;
    if (typeof currentVersion.value === "string" && currentVersion.value.trim().length > 0) return;
    if (!currentVersionPromise) {
      currentVersionPromise = (async () => {
        try {
          const { getVersion } = await import("@tauri-apps/api/app");
          const version = await getVersion();
          if (typeof version === "string" && version.trim().length > 0) {
            currentVersion.value = version;
          }
        } catch (error) {
          if (!isTestEnv()) {
            console.error("Failed to load current app version", error);
          }
        } finally {
          currentVersionPromise = null;
        }
      })();
    }
    await currentVersionPromise;
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

  const clearStaleCachedAvailableVersion = () => {
    const available = availableVersion.value;
    const current = currentVersion.value;
    if (!available || !current) return;
    const cmp = compareSemver(available, current);
    if (cmp == null) return;
    if (cmp > 0) return;

    updateHandle = null;
    availableVersion.value = null;
    availableBody.value = null;
    updateAvailable.value = false;

    const persistedAvailable = (appSettings.value as any)?.updater?.availableVersion;
    if (typeof persistedAvailable === "string" && persistedAvailable.trim().length > 0) {
      persistUpdaterPatch({ availableVersion: undefined });
    }
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
    await ensureCurrentVersionLoaded();
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
      await prepareAppUpdaterProxy();
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      const now = Date.now();

      lastCheckedAtMs.value = now;

      if (update) {
        updateHandle = update;
        availableVersion.value = update.version ?? null;
        availableBody.value = typeof update.body === "string" && update.body.trim().length > 0 ? update.body : null;
        if (currentVersion.value == null) {
          currentVersion.value = update.currentVersion ?? null;
        }
        clearStaleCachedAvailableVersion();
        updateAvailable.value = updaterConfigured.value === true && availableVersion.value != null;
        persistUpdaterPatch({
          lastCheckedAtMs: now,
          availableVersion: update.version ?? undefined,
        });
      } else {
        updateAvailable.value = false;
        availableVersion.value = null;
        availableBody.value = null;
        await ensureCurrentVersionLoaded();
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
      await prepareAppUpdaterProxy();
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
      availableBody.value = null;
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
    if (updaterConfigured.value !== true) {
      updateAvailable.value = false;
      return;
    }
    if (!availableVersion.value) {
      updateAvailable.value = false;
      return;
    }
    if (!currentVersion.value) {
      updateAvailable.value = false;
      return;
    }
    const cmp = compareSemver(availableVersion.value, currentVersion.value);
    updateAvailable.value = cmp == null ? true : cmp > 0;
  };

  watch(
    appSettings,
    (next) => {
      if (!next) return;
      const checkedAt = (next as any)?.updater?.lastCheckedAtMs;
      const available = (next as any)?.updater?.availableVersion;
      lastCheckedAtMs.value = typeof checkedAt === "number" ? checkedAt : null;
      availableVersion.value = typeof available === "string" ? available : null;
      void ensureCurrentVersionLoaded().finally(() => {
        clearStaleCachedAvailableVersion();
        recomputeUpdateAvailable();
      });
    },
    { flush: "post" },
  );

  watch(
    updaterConfigured,
    () => {
      void ensureCurrentVersionLoaded().finally(() => {
        clearStaleCachedAvailableVersion();
      });
      recomputeUpdateAvailable();
    },
    { flush: "post" },
  );

  watch(
    currentVersion,
    () => {
      clearStaleCachedAvailableVersion();
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
    void ensureCurrentVersionLoaded();
    void ensureUpdaterCapabilitiesLoaded().finally(() => {
      clearStaleCachedAvailableVersion();
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
    availableBody,
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
