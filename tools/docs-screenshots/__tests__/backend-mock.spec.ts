import { describe, expect, it } from "vitest";

import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

import {
  enqueueTranscodeJobs,
  expandManualJobInputs,
  loadSmartDefaultPresets,
  previewOutputPath,
} from "../mocks/backend";

describe("docs screenshots backend mock", () => {
  it("exports previewOutputPath compatible with OutputPolicyEditor", async () => {
    const resolved = await previewOutputPath({
      inputPath: "C:/videos/input.mp4",
      presetId: null,
      outputPolicy: DEFAULT_OUTPUT_POLICY,
    });

    expect(typeof resolved === "string" || resolved === null).toBe(true);
    expect(resolved).toContain("input");
  });

  it("exports expandManualJobInputs and enqueueTranscodeJobs", async () => {
    const expanded = await expandManualJobInputs(["  a.mp4  ", "", "b.mp4"], { recursive: true });
    expect(expanded).toEqual(["a.mp4", "b.mp4"]);

    const jobs = await enqueueTranscodeJobs({
      filenames: expanded,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0,
      presetId: "p1",
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.presetId).toBe("p1");
  });

  it("provides smart default presets for onboarding screenshots", async () => {
    const presets = await loadSmartDefaultPresets();
    expect(Array.isArray(presets)).toBe(true);
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]?.stats?.usageCount).toBeDefined();
  });
});
