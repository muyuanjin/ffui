<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "lucide-vue-next";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import { parseFfmpegError } from "@/lib/ffmpegError";

const props = defineProps<{
  job: TranscodeJob | null;
  preset: FFmpegPreset | null;
  ffmpegResolvedPath?: string | null;
  logText?: string | null;
}>();

const { t } = useI18n();

const getJobLogTextFallback = (job: TranscodeJob): string => {
  const parts: string[] = [];

  if (Array.isArray(job.runs)) {
    for (const run of job.runs) {
      if (!run?.logs?.length) continue;
      for (const line of run.logs) {
        if (typeof line === "string") parts.push(line);
        else if (line && typeof line === "object" && "text" in line && typeof line.text === "string")
          parts.push(line.text);
      }
    }
  }

  if (parts.length > 0) return parts.join("\n");

  if (Array.isArray(job.logs)) {
    for (const line of job.logs) {
      if (typeof line === "string") parts.push(line);
      else if (line && typeof line === "object" && "text" in line && typeof line.text === "string")
        parts.push(line.text);
    }
  }

  if (parts.length > 0) return parts.join("\n");

  return String(job.logTail ?? "").trim();
};

const tailLines = (text: string, maxLines: number) => {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) return text.trim();
  return lines.slice(-maxLines).join("\n").trim();
};

const failureDetailsOpen = ref(false);
watch(
  () => props.job?.id,
  () => {
    failureDetailsOpen.value = false;
  },
  { immediate: true },
);

const failureErrorUi = computed(() => {
  const job = props.job;
  if (!job || job.status !== "failed") return null;

  const failureReason = String(job.failureReason ?? "").trim();
  const logText = String(props.logText ?? "").trim() || getJobLogTextFallback(job);
  const logTail = tailLines(logText, 120);

  const parsedFromFailureReason = failureReason ? parseFfmpegError(failureReason) : null;
  const parsedFromLogTail = logTail ? parseFfmpegError(logTail) : null;
  const parsed =
    parsedFromFailureReason && parsedFromFailureReason.kind !== "unknown" ? parsedFromFailureReason : parsedFromLogTail;

  if (!parsed) return null;

  const ffmpegPath =
    "ffmpegPath" in parsed
      ? (parsed.ffmpegPath ?? props.ffmpegResolvedPath ?? undefined)
      : (props.ffmpegResolvedPath ?? undefined);
  const presetName = props.preset?.name ?? null;
  const presetEncoder = props.preset?.video.encoder ?? null;
  const detailsParts: string[] = [];
  if (failureReason) detailsParts.push(failureReason);
  if (logTail) detailsParts.push(`--- log tail ---\n${logTail}`);
  const details = detailsParts.filter(Boolean).join("\n\n").trim() || parsed.raw;

  if (parsed.kind === "missing_encoder") {
    const lines: string[] = [];
    lines.push(t("taskDetail.failureReasonMissingEncoderLine1", { encoder: parsed.encoder }) as string);
    if (presetName) {
      lines.push(t("taskDetail.failureReasonLinePreset", { presetName }) as string);
    }
    if (presetEncoder) {
      lines.push(t("taskDetail.failureReasonLinePresetEncoder", { encoder: presetEncoder }) as string);
    }
    if (ffmpegPath) {
      lines.push(t("taskDetail.failureReasonLineFfmpeg", { ffmpegPath }) as string);
    }
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: lines.join("\n"),
      actions: [
        t("taskDetail.failureReasonActionSwitchFfmpeg") as string,
        t("taskDetail.failureReasonActionChangePreset") as string,
      ],
      details,
    };
  }

  if (parsed.kind === "missing_decoder") {
    const lines: string[] = [];
    lines.push(t("taskDetail.failureReasonMissingDecoderLine1", { decoder: parsed.decoder }) as string);
    if (ffmpegPath) {
      lines.push(t("taskDetail.failureReasonLineFfmpeg", { ffmpegPath }) as string);
    }
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: lines.join("\n"),
      actions: [t("taskDetail.failureReasonActionSwitchFfmpeg") as string],
      details,
    };
  }

  if (parsed.kind === "missing_filter") {
    const lines: string[] = [];
    lines.push(t("taskDetail.failureReasonMissingFilterLine1", { filter: parsed.filter }) as string);
    if (ffmpegPath) {
      lines.push(t("taskDetail.failureReasonLineFfmpeg", { ffmpegPath }) as string);
    }
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: lines.join("\n"),
      actions: [t("taskDetail.failureReasonActionSwitchFfmpeg") as string],
      details,
    };
  }

  if (parsed.kind === "missing_library") {
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: t("taskDetail.failureReasonMissingLibraryLine1", { library: parsed.library }) as string,
      actions: [t("taskDetail.failureReasonActionSwitchFfmpeg") as string],
      details,
    };
  }

  if (parsed.kind === "input_not_found") {
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: t("taskDetail.failureReasonInputNotFound") as string,
      actions: [t("taskDetail.failureReasonActionCheckPaths") as string],
      details,
    };
  }

  if (parsed.kind === "permission_denied") {
    return {
      title: t("taskDetail.failureReasonTitle") as string,
      summary: t("taskDetail.failureReasonPermissionDenied") as string,
      actions: [t("taskDetail.failureReasonActionCheckPaths") as string],
      details,
    };
  }

  return {
    title: t("taskDetail.failureReasonTitle") as string,
    summary: t("taskDetail.failureReasonUnknown") as string,
    actions: [t("taskDetail.failureReasonActionCheckDetails") as string],
    details,
  };
});
</script>

<template>
  <div v-if="failureErrorUi" class="rounded-md border border-border/50 bg-card/50 p-3 space-y-2">
    <div class="text-[11px] font-medium text-destructive">{{ failureErrorUi.title }}</div>
    <div class="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed select-text">
      {{ failureErrorUi.summary }}
    </div>
    <ul v-if="failureErrorUi.actions.length > 0" class="list-disc pl-5 space-y-1">
      <li
        v-for="(a, i) in failureErrorUi.actions"
        :key="i"
        class="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed"
      >
        {{ a }}
      </li>
    </ul>
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-accent/20"
      :aria-expanded="failureDetailsOpen"
      aria-controls="task-detail-failure-details"
      @click="failureDetailsOpen = !failureDetailsOpen"
    >
      <span class="text-[11px] font-medium text-foreground">
        {{ failureDetailsOpen ? t("taskDetail.failureReasonHideDetails") : t("taskDetail.failureReasonShowDetails") }}
      </span>
      <ChevronDown
        class="h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
        :class="failureDetailsOpen ? 'rotate-180' : ''"
      />
    </button>
    <div
      id="task-detail-failure-details"
      class="grid px-2 transition-[grid-template-rows,opacity,padding-bottom] duration-200 ease-in-out motion-reduce:transition-none"
      :class="failureDetailsOpen ? 'grid-rows-[1fr] opacity-100 pb-2' : 'grid-rows-[0fr] opacity-0 pb-0'"
    >
      <pre class="overflow-hidden text-[10px] text-muted-foreground whitespace-pre-wrap break-words select-text">{{
        failureErrorUi.details
      }}</pre>
    </div>
  </div>
</template>
