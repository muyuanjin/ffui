import { onMounted, onUnmounted, ref, type Ref } from "vue";
import {
  PhysicalPosition,
  PhysicalSize,
  currentMonitor,
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { acknowledgeTaskbarProgress, hasTauri } from "@/lib/backend";
import { useWindowControls } from "@/composables";

export type MainAppTab = "queue" | "presets" | "media" | "monitor" | "settings";

export interface UseMainAppShellReturn {
  activeTab: Ref<MainAppTab>;
  screenFxOpen: Ref<boolean>;
  toggleScreenFx: () => void;
  closeScreenFx: () => void;
  toggleFullscreen: () => Promise<void>;
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
  const screenFxOpen = ref(false);

  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWindowControls();

  const appWindow = ref<TauriWindow | null>(null);
  let focusUnlisten: (() => void) | null = null;
  let focusListenerRegistrationStarted = false;

  const ensureWindowHandle = (): TauriWindow | null => {
    if (!hasTauri()) return null;
    if (appWindow.value) return appWindow.value;
    try {
      appWindow.value = getCurrentWindow();
      return appWindow.value;
    } catch (error) {
      console.error("Failed to get current window:", error);
      return null;
    }
  };

  const dispatchViewportResize = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("resize"));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  };

  let fullscreenRestore: null | {
    maximized: boolean;
    alwaysOnTop: boolean;
    position: { x: number; y: number };
    size: { width: number; height: number };
  } = null;

  const setFullscreen = async (wantFullscreen: boolean) => {
    if (hasTauri()) {
      const w = ensureWindowHandle();
      if (!w) return;
      try {
        const isFullscreen = await w.isFullscreen();
        if (wantFullscreen === isFullscreen) return;

        if (wantFullscreen) {
          const [maximized, alwaysOnTop, position, size] = await Promise.all([
            w.isMaximized(),
            w.isAlwaysOnTop(),
            w.outerPosition(),
            w.outerSize(),
          ]);

          fullscreenRestore = {
            maximized,
            alwaysOnTop,
            position: { x: position.x, y: position.y },
            size: { width: size.width, height: size.height },
          };

          if (maximized) {
            await w.unmaximize();
          }
        }

        await w.setFullscreen(wantFullscreen);

        if (wantFullscreen) {
          // Work around occasional Windows sizing glitches by force-covering the current monitor.
          // This also helps when fullscreen behaves like "maximized" (work area) instead of true fullscreen.
          const monitor = await currentMonitor();
          if (monitor) {
            try {
              await w.setAlwaysOnTop(true);
              await w.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
              await w.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
            } catch (err) {
              console.error("Failed to force fullscreen window bounds:", err);
            }
          }
        } else if (fullscreenRestore) {
          const restore = fullscreenRestore;
          fullscreenRestore = null;

          try {
            await w.setAlwaysOnTop(restore.alwaysOnTop);
          } catch (err) {
            console.error("Failed to restore always-on-top:", err);
          }

          if (restore.maximized) {
            await w.maximize();
          } else {
            await w.setPosition(new PhysicalPosition(restore.position.x, restore.position.y));
            await w.setSize(new PhysicalSize(restore.size.width, restore.size.height));
          }
        }

        dispatchViewportResize();
      } catch (error) {
        console.error("Failed to toggle Tauri fullscreen:", error);
      }
      return;
    }

    if (typeof document === "undefined") return;
    const doc = document as Document & {
      fullscreenElement?: Element | null;
      exitFullscreen?: () => Promise<void>;
    };
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };

    try {
      if (wantFullscreen) {
        await el.requestFullscreen?.();
      } else if (doc.fullscreenElement) {
        await doc.exitFullscreen?.();
      }
    } catch {
      // Best-effort only.
    }
  };

  const toggleFullscreen = async () => {
    if (hasTauri()) {
      const w = ensureWindowHandle();
      if (!w) return;
      try {
        const isFullscreen = await w.isFullscreen();
        await setFullscreen(!isFullscreen);
      } catch (error) {
        console.error("Failed to toggle Tauri fullscreen:", error);
      }
      return;
    }

    if (typeof document === "undefined") return;
    const doc = document as Document & { fullscreenElement?: Element | null };
    await setFullscreen(!doc.fullscreenElement);
  };

  const exitFullscreen = async () => {
    if (hasTauri()) {
      const w = ensureWindowHandle();
      if (!w) return;
      try {
        const isFullscreen = await w.isFullscreen();
        if (!isFullscreen) return;
        await setFullscreen(false);
      } catch (error) {
        console.error("Failed to exit Tauri fullscreen:", error);
      }
      return;
    }

    if (typeof document === "undefined") return;
    const doc = document as Document & { fullscreenElement?: Element | null };
    if (!doc.fullscreenElement) return;
    await setFullscreen(false);
  };

  const toggleScreenFx = () => {
    if (screenFxOpen.value) {
      closeScreenFx();
      return;
    }
    screenFxOpen.value = true;
  };

  const closeScreenFx = () => {
    if (!screenFxOpen.value) return;
    screenFxOpen.value = false;
    void exitFullscreen();
  };

  const registerFocusListenerOnce = async () => {
    if (!hasTauri()) return;
    if (focusListenerRegistrationStarted) return;
    focusListenerRegistrationStarted = true;

    const tauriWindow = ensureWindowHandle();
    if (!tauriWindow) return;

    try {
      // Best-effort: when the Tauri window regains focus, acknowledge any
      // completed taskbar progress so the OS indicator does not remain stuck.
      const maybeUnlisten = await (tauriWindow as Partial<TauriWindow>).listen?.("tauri://focus", async () => {
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
  };

  // Kick off focus listener registration as early as possible so tests and
  // fast startups can observe it without relying on timing quirks.
  queueMicrotask(() => {
    void registerFocusListenerOnce();
  });

  onMounted(() => {
    void registerFocusListenerOnce();
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
    screenFxOpen,
    toggleScreenFx,
    closeScreenFx,
    toggleFullscreen,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}

export default useMainAppShell;
