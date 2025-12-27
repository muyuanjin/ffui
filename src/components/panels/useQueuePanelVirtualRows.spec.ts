// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useQueuePanelVirtualRows } from "./useQueuePanelVirtualRows";

describe("useQueuePanelVirtualRows", () => {
  it("keeps virtualListKey stable across queue size changes", () => {
    const queueMode = ref<"queue" | "display">("queue");
    const queueRowVariant = ref<"detail" | "compact" | "mini">("detail");
    const queueViewMode = ref("list");

    const visibleQueueItems = ref<any[]>([]);
    const queueModeProcessingJobs = ref<any[]>([]);
    const queueModeWaitingItems = ref<any[]>([]);
    const queueModeWaitingBatchIds = ref<Set<string>>(new Set());

    const { virtualListKey } = useQueuePanelVirtualRows(
      () => ({
        queueMode: queueMode.value,
        queueRowVariant: queueRowVariant.value,
        queueViewMode: queueViewMode.value,
        visibleQueueItems: visibleQueueItems.value,
        queueModeProcessingJobs: queueModeProcessingJobs.value,
        queueModeWaitingItems: queueModeWaitingItems.value,
        queueModeWaitingBatchIds: queueModeWaitingBatchIds.value,
      }),
      (key) => key,
    );

    const initial = virtualListKey.value;

    visibleQueueItems.value = Array.from({ length: 200 }, () => ({ kind: "job" }));
    queueModeProcessingJobs.value = [{ id: "a" }, { id: "b" }];
    queueModeWaitingItems.value = Array.from({ length: 50 }, () => ({ kind: "job" }));

    expect(virtualListKey.value).toBe(initial);

    queueViewMode.value = "icon";
    expect(virtualListKey.value).not.toBe(initial);
  });
});
