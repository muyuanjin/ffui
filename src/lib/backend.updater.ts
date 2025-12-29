import { invokeWithAliases } from "./backend/invokeWithAliases";
import type { AppUpdaterCapabilities } from "./backend.types";
import { hasTauri } from "./backend.core";

export const fetchAppUpdaterCapabilities = async (): Promise<AppUpdaterCapabilities> => {
  if (!hasTauri()) return { configured: false };
  return invokeWithAliases<AppUpdaterCapabilities>("get_app_updater_capabilities");
};

export const prepareAppUpdaterProxy = async (): Promise<string | null> => {
  if (!hasTauri()) return null;
  return invokeWithAliases<string | null>("prepare_app_updater_proxy");
};
