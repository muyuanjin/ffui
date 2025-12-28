export type StateSyncPerfCounters = {
  syncJobObjectCalls: number;
  recomputeFastPathJobsScanned: number;
  recomputeRebuildJobsScanned: number;
  deltaIndexBuilds: number;
  deltaIndexJobsScanned: number;
};

const counters: StateSyncPerfCounters = {
  syncJobObjectCalls: 0,
  recomputeFastPathJobsScanned: 0,
  recomputeRebuildJobsScanned: 0,
  deltaIndexBuilds: 0,
  deltaIndexJobsScanned: 0,
};

export const stateSyncPerf = {
  reset: () => {
    counters.syncJobObjectCalls = 0;
    counters.recomputeFastPathJobsScanned = 0;
    counters.recomputeRebuildJobsScanned = 0;
    counters.deltaIndexBuilds = 0;
    counters.deltaIndexJobsScanned = 0;
  },
  get: (): StateSyncPerfCounters => ({ ...counters }),
  recordDeltaIndexBuild: (jobsLen: number) => {
    counters.deltaIndexBuilds += 1;
    counters.deltaIndexJobsScanned += jobsLen;
  },
  recordSyncJobObject: (count = 1) => {
    counters.syncJobObjectCalls += count;
  },
  recordRecomputeFastPathScan: (count = 1) => {
    counters.recomputeFastPathJobsScanned += count;
  },
  recordRecomputeRebuildScan: (count = 1) => {
    counters.recomputeRebuildJobsScanned += count;
  },
} as const;

export const __test = {
  resetPerfCounters: stateSyncPerf.reset,
  getPerfCounters: stateSyncPerf.get,
};
