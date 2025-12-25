// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { analyzeImportCommandLine } from "./presetCommandImport";

type CorpusFixtureSource = {
  path: string;
  sha256: string;
};

type CorpusFixtureEntry = {
  id: string;
  kind: "ffmpeg" | "argsOnly" | "nonFfmpeg" | string;
  normalizedBlock: string;
};

type CorpusFixture = {
  version: number;
  sources: CorpusFixtureSource[];
  entries: CorpusFixtureEntry[];
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const normalizeTextForHash = (value: string): string => {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const loadCorpusFixture = (): CorpusFixture => {
  const fixturePath = resolve(process.cwd(), "src-tauri/tests/ffmpeg-command-corpus.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as CorpusFixture;
};

describe("presetCommandImport corpus (docs/ffmpeg_commands*.txt)", () => {
  it("analyzes all ffmpeg-like commands without throwing and enforces key invariants", () => {
    const fixture = loadCorpusFixture();
    const sourcesByPath = new Map<string, string>(fixture.sources.map((s) => [s.path, s.sha256]));

    for (const [docPath, expectedHash] of sourcesByPath) {
      const abs = resolve(process.cwd(), docPath);
      const actualHash = sha256(normalizeTextForHash(readFileSync(abs, "utf8")));
      expect(actualHash).toBe(expectedHash);
    }

    const candidates = fixture.entries.filter((e) => e.kind !== "nonFfmpeg" && e.normalizedBlock.trim().length > 0);
    expect(candidates.length).toBeGreaterThan(0);

    for (const c of candidates) {
      const analysis = analyzeImportCommandLine(c.normalizedBlock);

      expect(analysis.trimmed.length).toBeGreaterThan(0);
      expect(analysis.normalizedTemplate.length).toBeGreaterThan(0);
      if (analysis.eligibility.custom || analysis.eligibility.editable) {
        expect(analysis.normalizedTemplate.toLowerCase().startsWith("ffmpeg")).toBe(true);
      }

      if (analysis.eligibility.custom) {
        expect(analysis.argsOnlyTemplate).not.toBeNull();
        expect(String(analysis.argsOnlyTemplate).trim().toLowerCase().startsWith("ffmpeg")).toBe(false);
        expect(analysis.normalizedTemplate.includes("INPUT")).toBe(true);
        expect(analysis.normalizedTemplate.includes("OUTPUT")).toBe(true);
      }

      if (analysis.eligibility.editable) {
        expect(analysis.structuredPreset).toBeTruthy();
        expect(analysis.structuredPreset?.advancedEnabled).toBe(false);
        expect(analysis.structuredPreset?.ffmpegTemplate).toBeFalsy();
      }
    }
  });

  it("produces a stable corpus summary snapshot (useful for regressions)", () => {
    const fixture = loadCorpusFixture();
    const candidates = fixture.entries.filter((e) => e.kind !== "nonFfmpeg" && e.normalizedBlock.trim().length > 0);
    const analyses = candidates.map((c) => {
      const analysis = analyzeImportCommandLine(c.normalizedBlock);
      return {
        id: c.id,
        custom: analysis.eligibility.custom,
        editable: analysis.eligibility.editable,
        reasonsTop: (analysis.reasons ?? []).slice(0, 2),
      };
    });

    const counts = {
      entries: fixture.entries.length,
      candidates: candidates.length,
      customEligible: analyses.filter((a) => a.custom).length,
      editableEligible: analyses.filter((a) => a.editable).length,
      blocked: analyses.filter((a) => !a.custom && !a.editable).length,
    };

    const topBlockedReasons = (() => {
      const freq = new Map<string, number>();
      for (const a of analyses) {
        if (a.custom || a.editable) continue;
        for (const r of a.reasonsTop) {
          const key = String(r ?? "").trim();
          if (!key) continue;
          freq.set(key, (freq.get(key) ?? 0) + 1);
        }
      }
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12)
        .map(([reason, count]) => ({ reason, count }));
    })();

    expect({
      counts,
      topBlockedReasons,
    }).toMatchSnapshot();
  });
});
