import { onMounted } from "vue";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

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
        if (flushInProgress) return;

        flushInProgress = true;
        try {
          event.preventDefault();
          await persistNow();
        } catch (error) {
          if (!isTestEnv) {
            console.error("Failed to flush app settings on close request", error);
          }
          flushInProgress = false;
          return;
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
