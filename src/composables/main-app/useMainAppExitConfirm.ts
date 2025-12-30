import { onMounted, onUnmounted } from "vue";
import type { ExitRequestPayload } from "@/types";
import type { UseDialogManagerReturn } from "@/composables/useDialogManager";
import { hasTauri } from "@/lib/backend";
import { subscribeTauriEvent, type UnsubscribeFn } from "@/lib/tauriSubscriptions";

export function useMainAppExitConfirm(dialogManager: UseDialogManagerReturn) {
  let unsubscribe: UnsubscribeFn | null = null;

  onMounted(async () => {
    if (!hasTauri()) return;

    try {
      unsubscribe = await subscribeTauriEvent<ExitRequestPayload>(
        "app://exit-requested",
        (payload) => {
          if (!payload) return;
          dialogManager.openExitConfirm(payload);
        },
        { debugLabel: "app://exit-requested" },
      );
    } catch (error) {
      console.error("Failed to listen for app exit request event:", error);
    }
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
}
