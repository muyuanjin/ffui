import type { DialogsDomain, SettingsDomain } from "@/MainApp.types";
import { useJobLog } from "@/composables";
import { useMainAppDialogs } from "@/composables/main-app/useMainAppDialogs";
import { useMainAppExitConfirm } from "@/composables/main-app/useMainAppExitConfirm";
import type { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";

export function useMainAppDialogsBase() {
  const dialogs = useMainAppDialogs();
  useMainAppExitConfirm(dialogs.dialogManager);
  return dialogs;
}

export interface UseMainAppDialogsDomainOptions {
  dialogs: ReturnType<typeof useMainAppDialogsBase>;
  batchCompress: ReturnType<typeof useMainAppBatchCompress>;
  settings: SettingsDomain;
}

export function useMainAppDialogsDomain(options: UseMainAppDialogsDomainOptions): DialogsDomain {
  const { dialogs, batchCompress, settings } = options;
  const { dialogManager } = dialogs;
  const { jobDetailLogText, jobDetailJob, highlightedLogHtml } = useJobLog({
    selectedJob: dialogManager.selectedJob,
    detailOpen: dialogManager.jobDetailOpen,
    pollIntervalMs: settings.progressUpdateIntervalMs,
  });

  return {
    ...dialogs,
    batchCompress,
    jobDetailJob,
    jobDetailLogText,
    highlightedLogHtml,
  };
}
