// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import en from "@/locales/en";
import JobFailureReasonCard from "@/components/dialogs/JobFailureReasonCard.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

const basePreset: FFmpegPreset = {
  id: "smart-av1-balanced",
  name: "Smart AV1 Balanced",
  description: "Preset used by tests",
  video: {
    encoder: "libsvtav1",
    rateControl: "crf",
    qualityValue: 34,
    preset: "8",
  },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

function makeJob(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/sample.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    presetId: basePreset.id,
    status: "failed",
    progress: 0,
    failureReason: "ffmpeg exited with non-zero status (exit code 1)",
    ...overrides,
  };
}

describe("JobFailureReasonCard", () => {
  it("infers missing encoder from log tail when failureReason is generic", () => {
    const logText = [
      "[vost#0:0 @ 00000231699d96c0] Unknown encoder 'libsvtav1'",
      "[vost#0:0 @ 00000231699d96c0] Error selecting an encoder",
      "Error opening output files: Encoder not found",
    ].join("\n");

    const wrapper = mount(JobFailureReasonCard, {
      props: {
        job: makeJob(),
        preset: basePreset,
        ffmpegResolvedPath: "C:/tools/ffmpeg.exe",
        logText,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("does not support the encoder: libsvtav1");
    expect(wrapper.text()).toContain("Preset: Smart AV1 Balanced");
    expect(wrapper.find("pre").text()).toContain("Unknown encoder 'libsvtav1'");
    expect(wrapper.find("pre").text()).toContain("ffmpeg exited with non-zero status");
  });
});
