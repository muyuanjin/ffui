export interface QueueOperationMethods {
  refreshQueueFromBackend: () => Promise<void>;
  handleWaitJob: (jobId: string) => Promise<void>;
  handleResumeJob: (jobId: string) => Promise<void>;
  handleRestartJob: (jobId: string) => Promise<void>;
  handleCancelJob: (jobId: string) => Promise<void>;
  enqueueManualJobFromPath: (path: string) => Promise<void>;
  enqueueManualJobsFromPaths: (paths: string[]) => Promise<void>;
}
