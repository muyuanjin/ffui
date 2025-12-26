import { nextTick, watch, type Ref } from "vue";
import { toast } from "vue-sonner";
import type { QueueStartupHintKind, TranscodeJob } from "@/types";
import { getQueueStartupHint, resumeStartupQueue } from "@/lib/backend.queue-startup";
import { hasTauri } from "@/lib/backend";

export interface UseQueueStartupToastOptions {
  enabled: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
  jobs: Ref<TranscodeJob[]>;
  lastQueueSnapshotRevision: Ref<number | null>;
  refreshQueueFromBackend: () => Promise<void>;
}

const descriptionKeyForKind = (kind: QueueStartupHintKind) => {
  if (kind === "pauseOnExit") return "queue.startupHint.descriptionPauseOnExit";
  if (kind === "crashOrKill") return "queue.startupHint.descriptionCrashOrKill";
  if (kind === "pausedQueue") return "queue.startupHint.descriptionPausedQueue";
  return "queue.startupHint.descriptionNormalRestart";
};

export function useQueueStartupToast(options: UseQueueStartupToastOptions) {
  const { enabled, t, jobs, lastQueueSnapshotRevision, refreshQueueFromBackend } = options;

  let checked = false;

  watch(
    [lastQueueSnapshotRevision, () => jobs.value.length],
    async () => {
      if (!enabled || checked) return;
      if (!hasTauri()) {
        checked = true;
        return;
      }
      checked = true;

      let hint: Awaited<ReturnType<typeof getQueueStartupHint>> = null;
      try {
        hint = await getQueueStartupHint();
      } catch (err) {
        checked = false;
        console.error("Failed to load queue startup hint:", err);
        return;
      }
      if (!hint) return;
      if (!Number.isFinite(hint.autoPausedJobCount) || hint.autoPausedJobCount <= 0) return;

      // Ensure the toast host is mounted (App.vue renders it after MainApp).
      await nextTick();

      toast.message(t("queue.startupHint.title"), {
        description: t(descriptionKeyForKind(hint.kind), { count: hint.autoPausedJobCount }),
        duration: 12_000,
        action: {
          label: t("queue.startupHint.action"),
          onClick: () => {
            void resumeStartupQueue()
              .then(() => refreshQueueFromBackend())
              .catch(() => {
                // Best-effort only: backend errors are surfaced by the normal queue refresh error handling.
              });
          },
        },
        cancel: {
          label: t("queue.startupHint.dismiss"),
          onClick: () => {},
        },
      });
    },
    { flush: "post", immediate: true },
  );
}
