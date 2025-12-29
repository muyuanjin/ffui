import { invokeWithAliases } from "./backend/invokeWithAliases";
import type { QueueStartupHint } from "@/types";
import { hasTauri } from "./backend.core";

export const getQueueStartupHint = async (): Promise<QueueStartupHint | null> => {
  if (!hasTauri()) return null;
  return invokeWithAliases<QueueStartupHint | null>("get_queue_startup_hint");
};

export const resumeStartupQueue = async (): Promise<number> => {
  if (!hasTauri()) return 0;
  return invokeWithAliases<number>("resume_startup_queue");
};

export const dismissQueueStartupHint = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invokeWithAliases<void>("dismiss_queue_startup_hint");
};
