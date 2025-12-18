import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { fetchTranscodeActivityToday, hasTauri } from "@/lib/backend";
import type { TranscodeActivityToday } from "@/types";

const EVENT_NAME = "ffui://transcode-activity-today";

export interface UseTranscodeActivityTodayReturn {
  activity: Readonly<Ref<TranscodeActivityToday | null>>;
  refresh: () => Promise<void>;
}

export function useTranscodeActivityToday(): UseTranscodeActivityTodayReturn {
  const activity = ref<TranscodeActivityToday | null>(null);
  let unlisten: UnlistenFn | null = null;

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
        unlisten = await listen<TranscodeActivityToday>(EVENT_NAME, (event) => {
          activity.value = event.payload;
        });
      } catch (error) {
        console.error("Failed to listen transcode activity events:", error);
      }
    })();
  });

  onUnmounted(() => {
    if (unlisten) {
      try {
        unlisten();
      } catch (error) {
        console.error("Failed to unlisten transcode activity events:", error);
      } finally {
        unlisten = null;
      }
    }
  });

  return { activity, refresh };
}
