import { invoke } from "@tauri-apps/api/core";
import type { ExitAutoWaitOutcome } from "../types";
import { hasTauri } from "./backend.core";

export const resetExitPrompt = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invoke<void>("reset_exit_prompt");
};

export const exitAppNow = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invoke<void>("exit_app_now");
};

export const exitAppWithAutoWait = async (): Promise<ExitAutoWaitOutcome> => {
  if (!hasTauri()) {
    throw new Error("exitAppWithAutoWait requires Tauri");
  }
  return invoke<ExitAutoWaitOutcome>("exit_app_with_auto_wait");
};
