import { nextTick, watch, type Ref } from "vue";
import { toast } from "vue-sonner";
import type { QueueStartupHintKind, TranscodeJob } from "@/types";
import { dismissQueueStartupHint, getQueueStartupHint, resumeStartupQueue } from "@/lib/backend.queue-startup";
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
      if (lastQueueSnapshotRevision.value === null) return;
      if (!hasTauri()) {
        checked = true;
        return;
      }

      // Startup-only: run exactly once after the first queue snapshot lands.
      checked = true;

      const hint = await getQueueStartupHint();
      if (!hint || hint.autoPausedJobCount <= 0) return;

      const kind: QueueStartupHintKind = hint.kind;
      const autoPausedJobCount = hint.autoPausedJobCount;

      // Ensure the toast host is mounted (App.vue renders it after MainApp).
      await nextTick();

      let resuming = false;
      const handleResume = async () => {
        if (resuming) return;
        resuming = true;
        try {
          const resumed = await resumeStartupQueue();
          if (resumed <= 0) await dismissQueueStartupHint();
          await refreshQueueFromBackend();
        } catch (error) {
          resuming = false;
          console.error("Failed to resume startup queue:", error);
        }
      };

      // Preload the i18n keys that the dialog will render (mainly for tests/mocks).
      t("queue.startupHint.title");
      t(descriptionKeyForKind(kind), { count: autoPausedJobCount });

      toast.success(t("queue.startupHint.title"), {
        description: t(descriptionKeyForKind(kind), { count: autoPausedJobCount }),
        duration: 12_000,
        closeButton: false,
        class: "border-l-4 shadow-xl",
        descriptionClass: "opacity-90",
        action: {
          label: t("queue.startupHint.actionResumeTranscoding"),
          onClick: () => {
            void handleResume();
          },
        },
        cancel: {
          label: t("queue.startupHint.close"),
          onClick: () => {
            void dismissQueueStartupHint().catch((error) => {
              console.error("Failed to dismiss queue startup hint:", error);
            });
          },
        },
      });
    },
    { flush: "post", immediate: true },
  );
}
