import { describe, expect, it } from "vitest";
import type { FFmpegPreset } from "@/types";
import { predictFromVqResults } from "./predict";
import type { VqResultsSnapshot } from "./types";

describe("predictFromVqResults", () => {
  it("maps CRF qualityValue onto the upstream quality axis (after bitrate cap) for x264/x265/svt curves", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 40 },
            { x: 2000, y: 36 },
            { x: 3000, y: 32 },
            { x: 4000, y: 28 },
            { x: 5000, y: 24 },
            { x: 6000, y: 20 },
          ],
        },
        {
          set: 2,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 900, y: 41 },
            { x: 1900, y: 37 },
            { x: 2900, y: 33 },
            { x: 3900, y: 29 },
            { x: 4900, y: 25 },
            { x: 5900, y: 21 },
          ],
        },
      ],
    };

    const preset: FFmpegPreset = {
      id: "p",
      name: "p",
      description: "",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 28, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const predicted = predictFromVqResults(snapshot, preset);
    expect(predicted?.datasetKey).toBe("x264_medium_crf");
    expect(predicted?.vmaf?.value).toBeCloseTo(28.5, 6);
    expect(predicted?.vmaf?.min).toBeCloseTo(28, 6);
    expect(predicted?.vmaf?.max).toBeCloseTo(29, 6);
    expect(predicted?.bitrateKbps).toBeCloseTo(3950, 6);
  });

  it("predicts metrics for x264 presets by sampling curves", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 95 },
          ],
        },
        {
          set: 2,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 91 },
            { x: 2000, y: 96 },
          ],
        },
        {
          set: 1,
          metric: "ssim",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 0.99 },
            { x: 2000, y: 0.995 },
          ],
        },
        {
          set: 1,
          metric: "fps",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 120 },
            { x: 2000, y: 100 },
          ],
        },
      ],
    };

    const preset: FFmpegPreset = {
      id: "p",
      name: "p",
      description: "",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 24, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const predicted = predictFromVqResults(snapshot, preset);
    expect(predicted?.datasetKey).toBe("x264_medium_crf");
    expect(predicted?.vmaf?.value).toBeGreaterThan(90);
    expect(predicted?.vmaf?.min).toBeDefined();
    expect(predicted?.vmaf?.max).toBeDefined();
    expect(predicted?.ssim?.value).toBeGreaterThan(0.98);
    expect(predicted?.fps?.value).toBeGreaterThan(0);
  });

  it("selects an available NVENC dataset key from snapshot", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "rtx4090_NVEncC_HEVC_quality",
          label: "NVENC HEVC quality",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 94 },
          ],
        },
        {
          set: 1,
          metric: "fps",
          key: "rtx4090_NVEncC_HEVC_quality",
          label: "NVENC HEVC quality",
          points: [
            { x: 1000, y: 500 },
            { x: 2000, y: 450 },
          ],
        },
      ],
    };

    const preset: FFmpegPreset = {
      id: "p",
      name: "p",
      description: "",
      video: { encoder: "hevc_nvenc", rateControl: "cq", qualityValue: 28, preset: "p5", pixFmt: "yuv420p" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const predicted = predictFromVqResults(snapshot, preset);
    expect(predicted?.datasetKey).toBe("rtx4090_NVEncC_HEVC_quality");
    expect(predicted?.vmaf?.value).toBeGreaterThan(0);
    expect(predicted?.fps?.value).toBeGreaterThan(0);
  });

  it("prefers a matching NVENC GPU model when hinted", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "rtx2070_NVEncC_HEVC_quality",
          label: "NVENC HEVC quality (rtx2070)",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 94 },
          ],
        },
        {
          set: 1,
          metric: "vmaf",
          key: "rtx4080_NVEncC_HEVC_quality",
          label: "NVENC HEVC quality (rtx4080)",
          points: [
            { x: 1000, y: 91 },
            { x: 2000, y: 95 },
          ],
        },
      ],
    };

    const preset: FFmpegPreset = {
      id: "p",
      name: "p",
      description: "",
      video: { encoder: "hevc_nvenc", rateControl: "cq", qualityValue: 28, preset: "p5", pixFmt: "yuv420p" },
      audio: { codec: "copy" as any },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const withoutHint = predictFromVqResults(snapshot, preset);
    expect(withoutHint?.datasetKey).toBe("rtx4080_NVEncC_HEVC_quality");

    const withHint = predictFromVqResults(snapshot, preset, { hardwareModelNameHint: "NVIDIA GeForce RTX 2070" });
    expect(withHint?.datasetKey).toBe("rtx2070_NVEncC_HEVC_quality");
  });

  it("uses qualityValue to choose a bitrate point for hardware encoders", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "rtx4090_NVEncC_HEVC_quality",
          label: "NVENC HEVC quality",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 94 },
          ],
        },
      ],
    };

    const betterQuality: FFmpegPreset = {
      id: "p1",
      name: "p1",
      description: "",
      video: { encoder: "hevc_nvenc", rateControl: "cq", qualityValue: 28, preset: "p5", pixFmt: "yuv420p" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const worseQuality: FFmpegPreset = {
      ...betterQuality,
      id: "p2",
      name: "p2",
      video: { ...betterQuality.video, qualityValue: 30 },
    };

    const a = predictFromVqResults(snapshot, betterQuality);
    const b = predictFromVqResults(snapshot, worseQuality);
    expect(a?.bitrateKbps).toBeGreaterThan(b?.bitrateKbps ?? 0);
    expect(a?.vmaf?.value).toBeGreaterThan(b?.vmaf?.value ?? 0);
  });

  it("keeps monotonic direction for VCEEncC (AMF) curves where higher vq_results quality means better", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "rx7900xt_VCEEncC_HEVC_normal",
          label: "AMF HEVC normal",
          points: [
            { x: 1000, y: 80 },
            { x: 2000, y: 85 },
            { x: 3000, y: 90 },
            { x: 4000, y: 94 },
          ],
        },
      ],
    };

    const betterQuality: FFmpegPreset = {
      id: "p1",
      name: "p1",
      description: "",
      video: { encoder: "hevc_amf", rateControl: "cq", qualityValue: 18, preset: "balanced", pixFmt: "yuv420p" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const worseQuality: FFmpegPreset = {
      ...betterQuality,
      id: "p2",
      name: "p2",
      video: { ...betterQuality.video, qualityValue: 40 },
    };

    const a = predictFromVqResults(snapshot, betterQuality);
    const b = predictFromVqResults(snapshot, worseQuality);
    expect(a?.datasetKey).toBe("rx7900xt_VCEEncC_HEVC_normal");
    expect(a?.bitrateKbps).toBeGreaterThan(b?.bitrateKbps ?? 0);
    expect(a?.vmaf?.value).toBeGreaterThan(b?.vmaf?.value ?? 0);
  });

  it("uses preset bitrateKbps (and clamps to curve span) for bitrate-driven modes", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 100 },
          ],
        },
      ],
    };

    const presetA: FFmpegPreset = {
      id: "pA",
      name: "pA",
      description: "",
      video: {
        encoder: "libx264",
        rateControl: "cbr",
        bitrateKbps: 1500,
        qualityValue: 1,
        preset: "medium",
      },
      audio: { codec: "copy" as any },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const presetB: FFmpegPreset = { ...presetA, id: "pB", name: "pB", video: { ...presetA.video, qualityValue: 50 } };

    const a = predictFromVqResults(snapshot, presetA);
    const b = predictFromVqResults(snapshot, presetB);
    expect(a?.bitrateKbps).toBeCloseTo(1500, 6);
    expect(b?.bitrateKbps).toBeCloseTo(1500, 6);
    expect(a?.vmaf?.value).toBeCloseTo(95, 6);
    expect(b?.vmaf?.value).toBeCloseTo(95, 6);

    const clamped = predictFromVqResults(snapshot, { ...presetA, video: { ...presetA.video, bitrateKbps: 9999 } });
    expect(clamped?.bitrateKbps).toBeCloseTo(2000, 6);
    expect(clamped?.vmaf?.value).toBeCloseTo(100, 6);
  });

  it("prefers an available CPU dataset key that matches the preset label when present", () => {
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: "https://example.invalid",
        dataUrl: "https://example.invalid/data.js",
        title: "Test",
        fetchedAtIso: new Date().toISOString(),
      },
      datasets: [
        {
          set: 1,
          metric: "vmaf",
          key: "x264_medium_crf",
          label: "x264 medium crf",
          points: [
            { x: 1000, y: 90 },
            { x: 2000, y: 95 },
          ],
        },
        {
          set: 1,
          metric: "vmaf",
          key: "x264_slow_crf",
          label: "x264 slow crf",
          points: [
            { x: 1000, y: 91 },
            { x: 2000, y: 96 },
          ],
        },
      ],
    };

    const preset: FFmpegPreset = {
      id: "p",
      name: "p",
      description: "",
      video: { encoder: "libx264", rateControl: "crf" as any, qualityValue: 24, preset: "slow" },
      audio: { codec: "copy" as any },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    };

    const predicted = predictFromVqResults(snapshot, preset);
    expect(predicted?.datasetKey).toBe("x264_slow_crf");
  });
});
