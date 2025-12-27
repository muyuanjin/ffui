import type { TranscodeJob } from "@/types";

export type QueueItemRowEmits = {
  (e: "toggle-select", id: string): void;
  (e: "wait", id: string): void;
  (e: "resume", id: string): void;
  (e: "restart", id: string): void;
  (e: "cancel", id: string): void;
  (e: "preview", job: TranscodeJob): void;
  (e: "preview-error"): void;
  (e: "inspect", job: TranscodeJob): void;
  (e: "compare", job: TranscodeJob): void;
};
