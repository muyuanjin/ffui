import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { acknowledgeTaskbarProgress, hasTauri } from "@/lib/backend";
import { useWindowControls } from "@/composables";

export type MainAppTab = "queue" | "presets" | "media" | "monitor" | "settings";

export interface UseMainAppShellReturn {
  activeTab: Ref<MainAppTab>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

/**
 * Shell-level concerns for MainApp:
 * - active tab routing
 * - window controls
 * - basic CPU/GPU monitoring
 * - taskbar progress acknowledgement on window focus
 */
export function useMainAppShell(): UseMainAppShellReturn {
  const activeTab = ref<MainAppTab>("queue");

  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWindowControls();

  const appWindow = ref<TauriWindow | null>(null);
  let focusUnlisten: (() => void) | null = null;

  onMounted(async () => {
    if (!hasTauri()) return;

    try {
      appWindow.value = await getCurrentWindow();

      try {
        // Best-effort: when the Tauri window regains focus, acknowledge any
        // completed taskbar progress so the OS indicator does not remain stuck.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const maybeUnlisten = await appWindow.value?.listen?.("tauri://focus", async () => {
          try {
            await acknowledgeTaskbarProgress();
          } catch (err) {
            console.error("Failed to acknowledge taskbar progress:", err);
          }
        });

        if (typeof maybeUnlisten === "function") {
          focusUnlisten = maybeUnlisten;
        }
      } catch (err) {
        console.error("Failed to register window focus listener:", err);
      }
    } catch (error) {
      console.error("Failed to get current window:", error);
    }
  });

  onUnmounted(() => {
    if (focusUnlisten) {
      try {
        focusUnlisten();
      } catch (err) {
        console.error("Failed to unlisten window focus event:", err);
      } finally {
        focusUnlisten = null;
      }
    }
  });

  return {
    activeTab,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}

export default useMainAppShell;
