import { describe, it, expect } from "vitest";
import type { OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { previewOutputPathLocal } from "@/lib/outputPolicyPreview";

describe("previewOutputPathLocal", () => {
  it("respects appendOrder for enabled suffix-like options", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "force", format: "mp4" },
      directory: { mode: "sameAsInput" },
      filename: {
        ...DEFAULT_OUTPUT_POLICY.filename,
        suffix: ".compressed",
        appendTimestamp: true,
        appendEncoderQuality: true,
        randomSuffixLen: 6,
        appendOrder: ["timestamp", "suffix", "random", "encoderQuality"],
      },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:/videos/input.mkv", policy);
    expect(out).toBe("C:/videos/input-YYYYMMDD-HHmmss.compressed-RANDOM-ENC-QUALITY.mp4");
  });

  it("normalizes fixed directories into a stable preview path", () => {
    const policy: OutputPolicy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "keepInput" },
      directory: { mode: "fixed", directory: "D:\\Outputs\\" },
      filename: { suffix: ".compressed", appendTimestamp: false, appendEncoderQuality: false },
      preserveFileTimes: false,
    };

    const out = previewOutputPathLocal("C:\\videos\\input.mp4", policy);
    expect(out).toBe("D:/Outputs/input.compressed.mp4");
  });
});
