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

  type FfuiQueuePerfSnapshot = {
    uptimeMs: number;
    events: {
      snapshots: number;
      deltas: number;
      deltaPatches: number;
      snapshotPayloadBytesSampled: number | null;
      deltaPayloadBytesSampled: number | null;
    };
    apply: {
      snapshotCalls: number;
      deltaCalls: number;
      snapshotAvgMs: number | null;
      deltaAvgMs: number | null;
      snapshotLastMs: number | null;
      deltaLastMs: number | null;
    };
    ui: {
      queueItemUpdates: number;
      queueIconItemUpdates: number;
      queuePanelVirtualRowsBuilds: number;
      queuePanelVirtualRowsAvgMs: number | null;
      queuePanelVirtualRowsLastMs: number | null;
    };
    loop: {
      rafFps: number | null;
      eventLoopLagP95Ms: number | null;
    };
  };

  interface Window {
    __FFUI_PRELOADED_APP_SETTINGS__?: AppSettings;
    __FFUI_STARTUP_METRICS__?: FfuiStartupMetrics;
    __FFUI_DUMP_STARTUP_METRICS__?: () => FfuiStartupDumpPayload;
    __FFUI_QUEUE_PERF__?: FfuiQueuePerfSnapshot;
  }
}

export {};
