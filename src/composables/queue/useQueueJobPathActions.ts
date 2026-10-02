import { computed, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { hasTauri, revealPathInFolder } from "@/lib/backend";
import { copyToClipboard } from "@/lib/copyToClipboard";

export function useQueueJobPathActions(job: Ref<TranscodeJob | null>, bulkJobs?: Ref<TranscodeJob[] | null>) {
  const normalizePath = (value: string | null | undefined): string | null => value?.trim() || null;
  const getInputPath = (item: TranscodeJob) => normalizePath(item.inputPath || item.filename);
  const getOutputPath = (item: TranscodeJob) => normalizePath(item.outputPath || item.waitMetadata?.tmpOutputPath);
  const inputPath = computed(() => (job.value ? getInputPath(job.value) : null));
  const outputPath = computed(() => (job.value ? getOutputPath(job.value) : null));
  const copyJobs = computed(() => bulkJobs?.value ?? (job.value ? [job.value] : []));
  const copyInputText = computed(() => copyJobs.value.map(getInputPath).filter(Boolean).join("\n"));
  const copyOutputText = computed(() => copyJobs.value.map(getOutputPath).filter(Boolean).join("\n"));
  const canRevealInputPath = computed(() => hasTauri() && !!inputPath.value);
  const canRevealOutputPath = computed(() => hasTauri() && !!outputPath.value);
  const canCopyOutputPath = computed(() => !!copyOutputText.value);

  const reveal = async (path: string | null) => {
    if (!path || !hasTauri()) return;
    try {
      await revealPathInFolder(path);
    } catch (error) {
      console.error("QueueContextMenu: failed to reveal path", error);
    }
  };
  const openInputFolder = () => reveal(inputPath.value);
  const openOutputFolder = () => reveal(outputPath.value);
  const copyInputPath = async () => {
    if (copyInputText.value) await copyToClipboard(copyInputText.value);
  };
  const copyOutputPath = async () => {
    if (copyOutputText.value) await copyToClipboard(copyOutputText.value);
  };

  return {
    canRevealInputPath,
    canRevealOutputPath,
    canCopyOutputPath,
    openInputFolder,
    openOutputFolder,
    copyInputPath,
    copyOutputPath,
  };
}
