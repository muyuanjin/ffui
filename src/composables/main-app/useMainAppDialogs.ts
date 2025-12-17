import { watch } from "vue";
import { useDialogManager } from "@/composables";

export interface UseMainAppDialogsReturn {
  dialogManager: ReturnType<typeof useDialogManager>;
  selectedJobForDetail: ReturnType<typeof useDialogManager>["selectedJob"];
}

/**
 * Dialog wiring for MainApp.
 *
 * Keeps a legacy `selectedJobForDetail` ref in sync with the newer dialog
 * manager so tests can keep using vm.selectedJobForDetail while the UI uses
 * the composable.
 */
export function useMainAppDialogs(): UseMainAppDialogsReturn {
  const dialogManager = useDialogManager();

  // Legacy alias so existing tests and integrations can keep using the older
  // field name while the new dialog manager remains the single source of truth.
  const selectedJobForDetail = dialogManager.selectedJob;

  watch(
    selectedJobForDetail,
    (job) => {
      // 仅当当前不是“预览/对比模式”时，才自动打开任务详情对话框。
      // - 兼容旧测试：直接设置 selectedJobForDetail 仍会触发详情。
      // - 队列中点击缩略图会走 dialogManager.openPreview，此时 previewOpen 为 true，
      //   不再联动打开任务详情。
      // - 点击“对比”会走 dialogManager.openJobCompare，此时 jobCompareOpen 为 true，
      //   不再联动打开任务详情。
      if (job && !dialogManager.previewOpen.value && !dialogManager.jobCompareOpen.value) {
        dialogManager.jobDetailOpen.value = true;
      }
    },
    { flush: "post" },
  );

  return {
    dialogManager,
    selectedJobForDetail,
  };
}

export default useMainAppDialogs;
