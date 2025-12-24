/// <reference types="vite/client" />

import type { AppSettings } from "./types";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

declare global {
  type FfuiStartupMetrics = Record<string, unknown> & {
    appMountMs?: number;
    navToMountMs?: number | null;
  };

  type FfuiStartupDumpPayload = {
    metrics: FfuiStartupMetrics;
    marks: Record<string, number | null>;
  };

  interface Window {
    __FFUI_PRELOADED_APP_SETTINGS__?: AppSettings;
    __FFUI_STARTUP_METRICS__?: FfuiStartupMetrics;
    __FFUI_DUMP_STARTUP_METRICS__?: () => FfuiStartupDumpPayload;
  }
}

export {};
