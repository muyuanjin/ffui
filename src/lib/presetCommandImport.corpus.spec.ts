// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { analyzeImportCommandLine } from "./presetCommandImport";

type CorpusSource = {
  file: string;
  lineStart: number;
  rawBlock: string;
  normalizedBlock: string;
};

const normalizeLineForExtraction = (line: string): string => {
  let s = String(line ?? "").replace(/\r/g, "");
  // Strip common REPL / markdown prompt prefixes.
  s = s.replace(/^\s*>\s?/, "");
  s = s.replace(/^\s*\$\s?/, "");
  // Trim surrounding backticks used as inline markdown quoting.
  s = s.trim();
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s;
};

const looksLikeFfmpegInvocationOrArgsOnly = (block: string): boolean => {
  const s = block.trim();
  if (!s) return false;
  if (s.startsWith("-")) return true; // args-only
  // Match ffmpeg token, ffmpeg.exe token, or a quoted/absolute path ending with ffmpeg(.exe)
  return /(^|[\s"']|[\\/])ffmpeg(?:\.exe)?(\s|$)/i.test(s);
};

const extractCommandBlocks = (text: string, file: string): CorpusSource[] => {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n");
  const out: CorpusSource[] = [];

  let inFence = false;
  let pending: string[] = [];
  let pendingStartLine = 1;

  const flush = () => {
    if (pending.length === 0) return;
    const rawBlock = pending.join("\n").trim();
    const normalizedBlock = rawBlock
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (normalizedBlock) {
      out.push({
        file,
        lineStart: pendingStartLine,
        rawBlock,
        normalizedBlock,
      });
    }
    pending = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    const line = normalizeLineForExtraction(raw);
    if (!line) {
      flush();
      continue;
    }

    // Treat obvious non-ffmpeg lines as separators so they don't get glued into a block.
    if (!inFence && !pending.length && !looksLikeFfmpegInvocationOrArgsOnly(line)) {
      continue;
    }

    if (pending.length === 0) pendingStartLine = i + 1;

    // Handle bash-style line continuation: trailing backslash joins with next line.
    if (line.endsWith("\\")) {
      pending.push(line.slice(0, -1).trimEnd());
      continue;
    }
    pending.push(line);
  }

  flush();

  return out;
};

const sha1 = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 12);

describe("presetCommandImport corpus (docs/ffmpeg_commands*.txt)", () => {
  it("analyzes all ffmpeg-like commands without throwing and enforces key invariants", () => {
    const files = ["docs/ffmpeg_commands.txt", "docs/ffmpeg_commands2.txt"];
    const sources: CorpusSource[] = [];

    for (const file of files) {
      const abs = resolve(process.cwd(), file);
      const text = readFileSync(abs, "utf8");
      sources.push(...extractCommandBlocks(text, file));
    }

    const candidates = sources.filter((s) => looksLikeFfmpegInvocationOrArgsOnly(s.normalizedBlock));
    expect(candidates.length).toBeGreaterThan(0);

    for (const c of candidates) {
      const analysis = analyzeImportCommandLine(c.normalizedBlock);

      expect(analysis.trimmed.length).toBeGreaterThan(0);
      expect(analysis.normalizedTemplate.length).toBeGreaterThan(0);
      expect(analysis.normalizedTemplate.toLowerCase().startsWith("ffmpeg")).toBe(true);

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
    const files = ["docs/ffmpeg_commands.txt", "docs/ffmpeg_commands2.txt"];
    const sources: CorpusSource[] = [];

    for (const file of files) {
      const abs = resolve(process.cwd(), file);
      const text = readFileSync(abs, "utf8");
      sources.push(...extractCommandBlocks(text, file));
    }

    const candidates = sources.filter((s) => looksLikeFfmpegInvocationOrArgsOnly(s.normalizedBlock));
    const analyses = candidates.map((c) => {
      const analysis = analyzeImportCommandLine(c.normalizedBlock);
      const id = `${c.file}:${c.lineStart}:${sha1(c.normalizedBlock)}`;
      return {
        id,
        custom: analysis.eligibility.custom,
        editable: analysis.eligibility.editable,
        reasonsTop: (analysis.reasons ?? []).slice(0, 2),
      };
    });

    const counts = {
      blocks: sources.length,
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
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([reason, count]) => ({ reason, count }));
    })();

    expect({
      counts,
      topBlockedReasons,
    }).toMatchSnapshot();
  });
});
