import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPresetCommandPreview } from "./ffmpegCommand";
import type { FFmpegPreset } from "@/types";

interface CommandContractCase {
  id: string;
  preset: FFmpegPreset;
  expectedCommand: string;
}

interface CommandContractFixtures {
  cases: CommandContractCase[];
}

const loadFixtures = (): CommandContractFixtures => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const root = path.resolve(__dirname, "..", "..", "src-tauri", "tests");
  const jsonPath = path.join(root, "ffmpeg-command-contract.json");
  const raw = fs.readFileSync(jsonPath, "utf8");
  return JSON.parse(raw) as CommandContractFixtures;
};

describe("FFmpeg structured preset → command contract (frontend)", () => {
  it("uses getPresetCommandPreview to match stored fixtures for representative presets", () => {
    const fixtures = loadFixtures();
    expect(fixtures.cases.length).toBeGreaterThan(0);

    for (const testCase of fixtures.cases) {
      const preview = getPresetCommandPreview(testCase.preset);
      expect(preview.length).toBeGreaterThan(0);
      expect(preview).toBe(
        testCase.expectedCommand,
      );
    }
  });
});

