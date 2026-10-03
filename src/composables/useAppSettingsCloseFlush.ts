import { onMounted } from "vue";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const CLOSE_FLUSH_TIMEOUT_MS = isTestEnv ? 50 : 800;

export const flushAppSettingsForClose = (persist: () => Promise<void>) =>
  withTimeout(persist(), CLOSE_FLUSH_TIMEOUT_MS);

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: number | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      window.clearTimeout(timeoutHandle);
    }
  }
};

export type InstallAppSettingsCloseFlushOptions = {
  enabled: () => boolean;
  persistNow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  onFlushError: (error: unknown) => void;
};

export type AppSettingsCloseFlushHandle = {
  cleanup: () => void;
};

export const installAppSettingsCloseFlush = (
  options: InstallAppSettingsCloseFlushOptions,
): AppSettingsCloseFlushHandle => {
  const { enabled, persistNow, closeWindow, onFlushError } = options;
  let unlisten: (() => void) | undefined;
  let flushInProgress = false;
  let disposed = false;

  onMounted(async () => {
    if (!enabled()) return;
    try {
      const win = await getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event: CloseRequestedEvent) => {
        event.preventDefault();
        if (flushInProgress) return;

        flushInProgress = true;
        try {
          await flushAppSettingsForClose(persistNow);
        } catch (error) {
          flushInProgress = false;
          onFlushError(error);
          return;
        }
        if (disposed) {
          flushInProgress = false;
          return;
        }

        try {
          await closeWindow();
        } catch (error) {
          if (!isTestEnv) {
            console.error("Failed to close window after flushing app settings", error);
          }
        } finally {
          flushInProgress = false;
        }
      });
      if (disposed) {
        unlisten();
        unlisten = undefined;
      }
    } catch (error) {
      if (!isTestEnv) {
        console.error("Failed to register window close requested handler", error);
      }
    }
  });

  return {
    cleanup: () => {
      disposed = true;
      if (!unlisten) return;
      try {
        unlisten();
      } catch (error) {
        if (!isTestEnv) {
          console.error("Failed to unlisten window close requested handler", error);
        }
      } finally {
        unlisten = undefined;
      }
    },
  };
};
