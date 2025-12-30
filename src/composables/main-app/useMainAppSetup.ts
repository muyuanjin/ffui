import { createMainAppContext, type MainAppContext } from "@/MainApp.setup";

export function useMainAppSetup() {
  return createMainAppContext();
}

export type MainAppSetup = MainAppContext;
