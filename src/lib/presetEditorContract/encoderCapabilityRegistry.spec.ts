import { describe, it, expect } from "vitest";
import type { VideoConfig } from "@/types";
import {
  applyEncoderChangePatch,
  applyRateControlChangePatch,
  normalizeVideoForSave,
} from "./encoderCapabilityRegistry";

describe("encoderCapabilityRegistry patches", () => {
  it("does not clear bitrate fields when switching rate control modes", () => {
    expect(applyRateControlChangePatch("crf")).toEqual({ rateControl: "crf" });
    expect(applyRateControlChangePatch("vbr")).toEqual({ rateControl: "vbr" });
    expect(applyRateControlChangePatch("constqp")).toEqual({ rateControl: "constqp" });
  });

  it("does not clear bitrate fields when switching encoder (unless encoder is copy)", () => {
    const current: VideoConfig = {
      encoder: "libx264",
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
      bitrateKbps: 3000,
      maxBitrateKbps: 4000,
      bufferSizeKbits: 6000,
      pass: 2,
    };

    const patch = applyEncoderChangePatch(current, "libx265");
    expect(patch).not.toHaveProperty("bitrateKbps");
    expect(patch).not.toHaveProperty("maxBitrateKbps");
    expect(patch).not.toHaveProperty("bufferSizeKbits");
    expect(patch).not.toHaveProperty("pass");
  });

  it("normalizes copy presets to drop video-only encoding fields", () => {
    const current: VideoConfig = {
      encoder: "copy",
      rateControl: "cbr",
      qualityValue: 23,
      preset: "copy",
      bitrateKbps: 3000,
      maxBitrateKbps: 4000,
      bufferSizeKbits: 6000,
      pass: 2,
    };

    const normalized = normalizeVideoForSave(current);
    expect(normalized.qualityValue).toBe(0);
    expect(normalized.preset).toBe("");
    expect(normalized.bitrateKbps).toBeUndefined();
    expect(normalized.maxBitrateKbps).toBeUndefined();
    expect(normalized.bufferSizeKbits).toBeUndefined();
    expect(normalized.pass).toBeUndefined();
  });
});
