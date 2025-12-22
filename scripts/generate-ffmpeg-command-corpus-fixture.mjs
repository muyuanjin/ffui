#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = process.cwd();

const DEFAULT_FIXTURE_PATH = path.join(ROOT, "src-tauri", "tests", "ffmpeg-command-corpus.fixture.json");
const DEFAULT_STRICT_PATH = path.join(ROOT, "src-tauri", "tests", "ffmpeg-command-corpus.strict.json");

const DEFAULT_DOC_SOURCES = ["docs/ffmpeg_commands.txt", "docs/ffmpeg_commands2.txt"];

function parseArgs(argv) {
  const out = {
    docs: [...DEFAULT_DOC_SOURCES],
    fixturePath: DEFAULT_FIXTURE_PATH,
    strictPath: DEFAULT_STRICT_PATH,
    mode: "write", // write | check | print
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/generate-ffmpeg-command-corpus-fixture.mjs [options]",
          "",
          "Options:",
          "  --docs <a,b,c>     Comma-separated doc paths (default: docs/ffmpeg_commands*.txt)",
          "  --out <path>       Fixture output path (default: src-tauri/tests/ffmpeg-command-corpus.fixture.json)",
          "  --strict-out <path> Strict subset output path (default: src-tauri/tests/ffmpeg-command-corpus.strict.json)",
          "  --check            Verify outputs match checked-in files (exit 1 if not)",
          "  --print            Print fixture JSON to stdout (no writes)",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    if (arg === "--docs") {
      const value = argv[i + 1];
      if (!value) throw new Error("--docs requires a value");
      out.docs = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a value");
      out.fixturePath = path.resolve(ROOT, value);
      i += 1;
      continue;
    }

    if (arg === "--strict-out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--strict-out requires a value");
      out.strictPath = path.resolve(ROOT, value);
      i += 1;
      continue;
    }

    if (arg === "--check") {
      out.mode = "check";
      continue;
    }

    if (arg === "--print") {
      out.mode = "print";
      continue;
    }

    throw new Error(`Unknown arg: ${arg}`);
  }

  return out;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeLineForExtraction(line) {
  let s = String(line ?? "").replace(/\r/g, "");
  s = s.replace(/^\s*>\s?/, "");
  s = s.replace(/^\s*\$\s?/, "");
  s = s.trim();
  if (s.startsWith("`") && s.endsWith("`") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function looksLikeFfmpegInvocationOrArgsOnly(block) {
  const s = String(block ?? "").trim();
  if (!s) return false;
  if (s.startsWith("-")) return true;
  return /(^|[\s"']|[\\/])ffmpeg(?:\\.exe)?(\s|$)/i.test(s);
}

function classifyKind(normalizedBlock) {
  const s = String(normalizedBlock ?? "").trim();
  if (!s) return "nonFfmpeg";
  if (s.startsWith("-")) return "argsOnly";
  if (/(^|[\s"']|[\\/])ffmpeg(?:\\.exe)?(\s|$)/i.test(s)) return "ffmpeg";
  return "nonFfmpeg";
}

function extractCommandBlocks(text, file) {
  const lines = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n");
  const out = [];

  let inFence = false;
  let pending = [];
  let pendingStartLine = 1;
  let lastLineHadContinuation = false;

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
      flush();
      inFence = !inFence;
      lastLineHadContinuation = false;
      continue;
    }

    let line = normalizeLineForExtraction(raw);
    if (!line) {
      flush();
      lastLineHadContinuation = false;
      continue;
    }

    if (!inFence && pending.length === 0 && !looksLikeFfmpegInvocationOrArgsOnly(line)) {
      continue;
    }

    // If the docs are a "one command per line" list (common), treat each line
    // as its own block unless there is an explicit line continuation.
    if (pending.length > 0 && !lastLineHadContinuation) {
      flush();
    }

    if (pending.length === 0) {
      pendingStartLine = i + 1;
    }

    if (/\\\s*$/.test(line)) {
      line = line.replace(/\\\s*$/, "").trimEnd();
      pending.push(line);
      lastLineHadContinuation = true;
      continue;
    }

    pending.push(line);
    lastLineHadContinuation = false;
  }

  flush();

  return out;
}

function stableId(file, lineStart, normalizedBlock) {
  const hash = crypto.createHash("sha1").update(normalizedBlock).digest("hex").slice(0, 12);
  return `${file}:${lineStart}:${hash}`;
}

async function loadFrontendImportAnalysisBindings() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffui-corpus-bindings-"));
  const bundleOutPath = path.join(tmpDir, "bundle.mjs");
  try {
    await esbuild.build({
      stdin: {
        contents: [
          'export { analyzeImportCommandLine } from "./src/lib/preset-command-import/analyze";',
          'export { splitCommandLine, stripQuotes } from "./src/lib/preset-command-import/utils";',
          "",
        ].join("\n"),
        resolveDir: ROOT,
        sourcefile: "ffui-corpus-bindings-entry.mjs",
        loader: "js",
      },
      outfile: bundleOutPath,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
      sourcemap: false,
      legalComments: "none",
      logLevel: "silent",
      tsconfig: path.join(ROOT, "tsconfig.json"),
    });

    const mod = await import(pathToFileURL(bundleOutPath).href);
    if (typeof mod.analyzeImportCommandLine !== "function") {
      throw new Error("failed to load analyzeImportCommandLine from bundled module");
    }
    if (typeof mod.splitCommandLine !== "function" || typeof mod.stripQuotes !== "function") {
      throw new Error("failed to load splitCommandLine/stripQuotes from bundled module");
    }
    return {
      analyzeImportCommandLine: mod.analyzeImportCommandLine,
      splitCommandLine: mod.splitCommandLine,
      stripQuotes: mod.stripQuotes,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function pickStrictCases(entries, maxCount) {
  const isTricky = (e) => {
    const tpl = e.argsOnlyTemplate ?? "";
    if (!tpl) return false;
    if (/[\"']/.test(tpl)) return true;
    if (/\\/.test(tpl)) return true;
    if (/filter_complex/i.test(tpl)) return true;
    if (/(^|\\s)-metadata(\\s|$)/i.test(tpl)) return true;
    if (/Program Files/i.test(e.normalizedBlock)) return true;
    return false;
  };

  const tricky = entries.filter((e) => e.argsOnlyTemplate && isTricky(e));
  return tricky.slice(0, maxCount);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  for (const p of args.docs) {
    const abs = path.resolve(ROOT, p);
    if (!fs.existsSync(abs)) throw new Error(`docs source not found: ${p}`);
  }

  const bindings = await loadFrontendImportAnalysisBindings();

  const sources = args.docs.map((docPath) => {
    const abs = path.resolve(ROOT, docPath);
    const raw = fs.readFileSync(abs, "utf8");
    return { path: docPath, sha256: sha256(raw), raw };
  });

  const blocks = [];
  for (const s of sources) {
    blocks.push(...extractCommandBlocks(s.raw, s.path));
  }

  const entries = blocks.map((b) => {
    const kind = classifyKind(b.normalizedBlock);
    const id = stableId(b.file, b.lineStart, b.normalizedBlock);

    let argsOnlyTemplate = null;
    let customEligible = false;
    let editableEligible = false;
    let reasonsTop = [];

    if (kind !== "nonFfmpeg") {
      const analysis = bindings.analyzeImportCommandLine(b.normalizedBlock);
      customEligible = !!analysis?.eligibility?.custom;
      editableEligible = !!analysis?.eligibility?.editable;
      reasonsTop = Array.isArray(analysis?.reasons) ? analysis.reasons.slice(0, 2) : [];
      if (customEligible) {
        argsOnlyTemplate = analysis.argsOnlyTemplate;
        if (!argsOnlyTemplate || String(argsOnlyTemplate).trim().length === 0) {
          throw new Error(`entry ${id} is custom-eligible but has no argsOnlyTemplate`);
        }
      }
    }

    return {
      id,
      source: { path: b.file, lineStart: b.lineStart },
      kind,
      rawBlock: b.rawBlock,
      normalizedBlock: b.normalizedBlock,
      analysis: {
        customEligible,
        editableEligible,
        reasonsTop,
      },
      argsOnlyTemplate,
    };
  });

  const fixture = {
    version: 1,
    sources: sources.map((s) => ({ path: s.path, sha256: s.sha256 })),
    entries,
  };

  const strictInputPath = "C:/FFUI Inputs/Input File.mp4";
  const strictOutputPath = "C:/FFUI Outputs/Out File.mp4";
  const strictSelected = pickStrictCases(entries, 12);
  const strict = {
    version: 1,
    inputPath: strictInputPath,
    outputPath: strictOutputPath,
    cases: strictSelected.map((e) => {
      const tpl = String(e.argsOnlyTemplate ?? "");
      const tokens = bindings
        .splitCommandLine(tpl)
        .map((t) => bindings.stripQuotes(t))
        .filter(Boolean);

      const replaced = tokens.map((t) => t.replace(/INPUT/g, strictInputPath).replace(/OUTPUT/g, strictOutputPath));
      const expectedArgv = replaced.slice();
      if (!expectedArgv.includes("-progress")) {
        expectedArgv.unshift("pipe:2");
        expectedArgv.unshift("-progress");
      }
      if (!expectedArgv.includes("-nostdin")) {
        expectedArgv.push("-nostdin");
      }

      return {
        id: e.id,
        source: e.source,
        argsOnlyTemplate: tpl,
        expectedArgv,
      };
    }),
  };

  const fixtureJson = `${JSON.stringify(fixture, null, 2)}\n`;
  const strictJson = `${JSON.stringify(strict, null, 2)}\n`;

  if (args.mode === "print") {
    process.stdout.write(fixtureJson);
    return;
  }

  if (args.mode === "check") {
    const existingFixture = fs.existsSync(args.fixturePath) ? fs.readFileSync(args.fixturePath, "utf8") : "";
    const existingStrict = fs.existsSync(args.strictPath) ? fs.readFileSync(args.strictPath, "utf8") : "";
    if (existingFixture !== fixtureJson || existingStrict !== strictJson) {
      process.stderr.write(
        [
          "Corpus fixtures are out of date.",
          "",
          "Regenerate with:",
          "  node scripts/generate-ffmpeg-command-corpus-fixture.mjs",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    process.stdout.write("OK: corpus fixtures match\n");
    return;
  }

  fs.mkdirSync(path.dirname(args.fixturePath), { recursive: true });
  fs.mkdirSync(path.dirname(args.strictPath), { recursive: true });
  fs.writeFileSync(args.fixturePath, fixtureJson, "utf8");
  fs.writeFileSync(args.strictPath, strictJson, "utf8");
  process.stdout.write(`Wrote ${path.relative(ROOT, args.fixturePath)}\n`);
  process.stdout.write(`Wrote ${path.relative(ROOT, args.strictPath)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
