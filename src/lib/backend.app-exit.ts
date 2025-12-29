import { invokeCommand } from "./backend/invokeCommand";
import type { ExitAutoWaitOutcome } from "../types";
import { hasTauri } from "./backend.core";

export const resetExitPrompt = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invokeCommand<void>("reset_exit_prompt");
};

export const exitAppNow = async (): Promise<void> => {
  if (!hasTauri()) return;
  await invokeCommand<void>("exit_app_now");
};

export const exitAppWithAutoWait = async (): Promise<ExitAutoWaitOutcome> => {
  if (!hasTauri()) {
    throw new Error("exitAppWithAutoWait requires Tauri");
  }
  return invokeCommand<ExitAutoWaitOutcome>("exit_app_with_auto_wait");
};
