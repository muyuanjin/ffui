import { ref, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { hasTauri } from "@/lib/backend";

/**
 * 窗口控制 Composable
 *
 * @description 提供窗口最小化、最大化、关闭等操作
 * @returns 窗口控制方法
 *
 * @example
 * ```typescript
 * const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWindowControls();
 * ```
 */
export function useWindowControls() {
  const appWindow = ref<TauriWindow | null>(null);

  const minimizeWindow = async () => {
    try {
      const win = appWindow.value ?? (await getCurrentWindow());
      await win.minimize();
    } catch (e) {
      console.error("Failed to minimize window:", e);
    }
  };

  const toggleMaximizeWindow = async () => {
    try {
      const win = appWindow.value ?? (await getCurrentWindow());
      await win.toggleMaximize();
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  const closeWindow = async () => {
    try {
      const win = appWindow.value ?? (await getCurrentWindow());
      await win.close();
    } catch (e) {
      console.error("Failed to close window:", e);
    }
  };

  onMounted(async () => {
    if (hasTauri()) {
      appWindow.value = await getCurrentWindow();
    }
  });

  return {
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}
