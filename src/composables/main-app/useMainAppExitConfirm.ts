import { onMounted, onUnmounted } from "vue";
import { listen } from "@tauri-apps/api/event";
import type { ExitRequestPayload } from "@/types";
import type { UseDialogManagerReturn } from "@/composables/useDialogManager";
import { hasTauri } from "@/lib/backend";

export function useMainAppExitConfirm(dialogManager: UseDialogManagerReturn) {
  let unlisten: (() => void) | null = null;

  onMounted(async () => {
    if (!hasTauri()) return;

    try {
      unlisten = await listen<ExitRequestPayload>("app://exit-requested", (event) => {
        const payload = event.payload;
        if (!payload) return;
        dialogManager.openExitConfirm(payload);
      });
    } catch (error) {
      console.error("Failed to listen for app exit request event:", error);
    }
  });

  onUnmounted(() => {
    if (unlisten) {
      try {
        unlisten();
      } catch (error) {
        console.error("Failed to unlisten app exit request event:", error);
      } finally {
        unlisten = null;
      }
    }
  });
}
