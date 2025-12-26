import { invoke } from "@tauri-apps/api/core";
import type { QueueStartupHint } from "@/types";
import { hasTauri } from "./backend.core";

export const getQueueStartupHint = async (): Promise<QueueStartupHint | null> => {
  if (!hasTauri()) return null;
  return invoke<QueueStartupHint | null>("get_queue_startup_hint");
};

export const resumeStartupQueue = async (): Promise<number> => {
  if (!hasTauri()) return 0;
  return invoke<number>("resume_startup_queue");
};
