import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { subscribeTauriEvent, type UnsubscribeFn } from "@/lib/tauriSubscriptions";

import { fetchTranscodeActivityToday, hasTauri } from "@/lib/backend";
import type { TranscodeActivityToday } from "@/types";

const EVENT_NAME = "ffui://transcode-activity-today";

export interface UseTranscodeActivityTodayReturn {
  activity: Readonly<Ref<TranscodeActivityToday | null>>;
  refresh: () => Promise<void>;
}

export function useTranscodeActivityToday(): UseTranscodeActivityTodayReturn {
  const activity = ref<TranscodeActivityToday | null>(null);
  let unsubscribe: UnsubscribeFn | null = null;

  const refresh = async () => {
    try {
      activity.value = await fetchTranscodeActivityToday();
    } catch (error) {
      console.error("Failed to fetch transcode activity today:", error);
    }
  };

  onMounted(() => {
    void refresh();

    if (!hasTauri()) return;
    void (async () => {
      try {
        unsubscribe = await subscribeTauriEvent<TranscodeActivityToday>(
          EVENT_NAME,
          (payload) => {
            activity.value = payload;
          },
          { debugLabel: EVENT_NAME },
        );
      } catch (error) {
        console.error("Failed to listen transcode activity events:", error);
      }
    })();
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { activity, refresh };
}
