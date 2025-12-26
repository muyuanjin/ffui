import { computed, ref, watch, type ComputedRef } from "vue";
import type { TranscodeJob } from "@/types";
import {
  applyProgramOverridesToCommand,
  highlightFfmpegCommand,
  highlightFfmpegCommandTokens,
  normalizeFfmpegTemplate,
} from "@/lib/ffmpegCommand";

type CommandViewDefaultMode = "status" | "template" | "full";

const isPreExecutionStatus = (status: TranscodeJob["status"] | undefined) => {
  return status === "queued" || status === "paused";
};

type CommandViewTranslator = (key: string) => string;

export const useFfmpegCommandView = (options: {
  jobId: ComputedRef<string | undefined>;
  status: ComputedRef<TranscodeJob["status"] | undefined>;
  rawCommand: ComputedRef<string>;
  ffmpegResolvedPath: ComputedRef<string | null | undefined>;
  t: CommandViewTranslator;
  defaultMode?: CommandViewDefaultMode;
}) => {
  const defaultMode: CommandViewDefaultMode = options.defaultMode ?? "status";
  const defaultShowTemplate = (status: TranscodeJob["status"] | undefined) => {
    if (defaultMode === "template") return true;
    if (defaultMode === "full") return false;
    return isPreExecutionStatus(status);
  };

  const showTemplateCommand = ref(defaultShowTemplate(options.status.value));
  const userToggledCommandView = ref(false);

  const templateCommand = computed(() => {
    const raw = options.rawCommand.value;
    if (!raw) return "";
    return normalizeFfmpegTemplate(raw).template;
  });

  const fullCommand = computed(() => {
    const raw = options.rawCommand.value;
    if (!raw) return "";
    const ffmpegOverride = options.ffmpegResolvedPath.value ?? null;
    if (!ffmpegOverride) return raw;
    return applyProgramOverridesToCommand(raw, { ffmpeg: ffmpegOverride });
  });

  const effectiveCommand = computed(() => {
    const raw = options.rawCommand.value;
    const templ = templateCommand.value;
    return showTemplateCommand.value ? templ || raw : fullCommand.value || raw;
  });

  const hasDistinctTemplate = computed(() => {
    const raw = options.rawCommand.value;
    const templ = templateCommand.value;
    return !!raw && !!templ && templ !== raw;
  });

  const toggle = () => {
    if (!hasDistinctTemplate.value) return;
    userToggledCommandView.value = true;
    showTemplateCommand.value = !showTemplateCommand.value;
  };

  watch(
    options.jobId,
    () => {
      userToggledCommandView.value = false;
      showTemplateCommand.value = defaultShowTemplate(options.status.value);
    },
    { immediate: true },
  );

  watch(options.status, (status) => {
    if (userToggledCommandView.value) return;
    showTemplateCommand.value = defaultShowTemplate(status);
  });

  const toggleLabel = computed(() => {
    if (!hasDistinctTemplate.value) return "";
    return showTemplateCommand.value
      ? options.t("taskDetail.commandToggle.showFull")
      : options.t("taskDetail.commandToggle.showTemplate");
  });

  const highlightedHtml = computed(() => highlightFfmpegCommand(effectiveCommand.value));
  const highlightedTokens = computed(() => highlightFfmpegCommandTokens(effectiveCommand.value));

  return {
    effectiveCommand,
    hasDistinctTemplate,
    highlightedHtml,
    highlightedTokens,
    templateCommand,
    toggle,
    toggleLabel,
  };
};
