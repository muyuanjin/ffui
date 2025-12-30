import type { ComputedRef, Ref } from "vue";
import type { TranscodeJob } from "@/types";
import type { UseMainAppQueueReturn } from "@/composables/main-app/useMainAppQueue";
import type { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import type { createQueuePanelProps } from "@/composables/main-app/queuePanelBindings";
import type { useQueueContextMenu } from "@/composables/main-app/useQueueContextMenu";
import type { useQueueOutputPolicy } from "@/composables/main-app/useQueueOutputPolicy";

export type MainAppQueueTabModule = UseMainAppQueueReturn & {
  selectionBarPinned: ComputedRef<boolean>;
  setSelectionBarPinned: (pinned: boolean) => void;
  queueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["queueOutputPolicy"];
  setQueueOutputPolicy: ReturnType<typeof useQueueOutputPolicy>["setQueueOutputPolicy"];
  queuePanelProps: ReturnType<typeof createQueuePanelProps>;
  queueTotalCount: ComputedRef<number>;
  jobs: Ref<TranscodeJob[]>;
  queueError: Ref<string | null>;
  completedCount: ComputedRef<number>;
  lastDroppedRoot: Ref<string | null>;
  dnd: ReturnType<typeof useMainAppDnDAndContextMenu>;
  queueContextMenu: ReturnType<typeof useQueueContextMenu>;
};
