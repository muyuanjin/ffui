export interface ExitRequestPayload {
  processingJobCount: number;
  timeoutSeconds: number;
}

export interface ExitAutoWaitOutcome {
  requestedJobCount: number;
  completedJobCount: number;
  timedOutJobCount: number;
  timeoutSeconds: number;
}
