import { onMounted } from "vue";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

/** 生产环境等待最后一次设置落盘的上限；测试环境用更短超时，避免拖慢用例。 */
export const PRODUCTION_CLOSE_FLUSH_TIMEOUT_MS = 2_000;

const CLOSE_FLUSH_TIMEOUT_MS = isTestEnv ? 50 : PRODUCTION_CLOSE_FLUSH_TIMEOUT_MS;

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
};

export type AppSettingsCloseFlushHandle = {
  cleanup: () => void;
};

export const installAppSettingsCloseFlush = (
  options: InstallAppSettingsCloseFlushOptions,
): AppSettingsCloseFlushHandle => {
  const { enabled, persistNow } = options;
  let unlisten: (() => void) | undefined;
  let flushInProgress = false;
  let ignoreNextCloseRequest = false;

  onMounted(async () => {
    if (!enabled()) return;
    try {
      const win = await getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event: CloseRequestedEvent) => {
        if (ignoreNextCloseRequest) {
          ignoreNextCloseRequest = false;
          return;
        }
        event.preventDefault();
        if (flushInProgress) return;

        flushInProgress = true;
        try {
          await withTimeout(persistNow(), CLOSE_FLUSH_TIMEOUT_MS);
        } catch (error) {
          if (!isTestEnv) {
            console.error("Failed to flush app settings on close request", error);
          }
        }

        try {
          ignoreNextCloseRequest = true;
          await win.close();
        } catch (error) {
          if (!isTestEnv) {
            console.error("Failed to close window after flushing app settings", error);
          }
          ignoreNextCloseRequest = false;
        } finally {
          flushInProgress = false;
        }
      });
    } catch (error) {
      if (!isTestEnv) {
        console.error("Failed to register window close requested handler", error);
      }
    }
  });

  return {
    cleanup: () => {
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
