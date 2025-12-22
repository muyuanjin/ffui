#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function usage(exitCode = 0) {
  const lines = [
    "Usage:",
    "  node scripts/set-version.mjs <version> [--notes] [--notes-prev=vX.Y.Z] [--force] [--dry-run]",
    "",
    "Examples:",
    "  npm run version:set -- 0.2.2",
    "  npm run version:set -- 0.2.2 --notes",
    "  npm run version:set -- 0.2.2 --notes --notes-prev=v0.2.1",
    "",
    "Edits:",
    "  - package.json",
    "  - src-tauri/Cargo.toml",
    "  - src-tauri/tauri.conf.json",
    "Optional:",
    "  - releases/v<version>.md (when --notes is set)",
    "",
  ];
  process.stdout.write(lines.join("\n"));
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {
    version: "",
    notes: false,
    notesPrev: "",
    force: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--notes") out.notes = true;
    if (arg === "--force") out.force = true;
    if (arg === "--dry-run") out.dryRun = true;

    const prev = arg.match(/^--notes-prev=(.+)$/);
    if (prev) out.notesPrev = prev[1].trim();

    if (!arg.startsWith("--") && !out.version) out.version = arg.trim();
  }

  if (!out.version) usage(2);
  return out;
}

function assertSemver(version) {
  // Allow SemVer + pre-release/build metadata, e.g. 0.2.2, 0.2.2-beta.1, 0.2.2+build.7
  const ok = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(version);
  if (!ok) {
    process.stderr.write(`ERROR: Invalid version: ${version}\n`);
    process.stderr.write("Expected: X.Y.Z (optionally with -prerelease and/or +build)\n");
    process.exit(2);
  }
}

function replaceFirstJsonVersion(raw, version, filePathForError) {
  const re = /("version"\s*:\s*")([^"]+)(")/;
  if (!re.test(raw)) {
    throw new Error(`No JSON "version" field found in ${filePathForError}`);
  }
  return raw.replace(re, `$1${version}$3`);
}

function replaceCargoPackageVersion(raw, version, filePathForError) {
  const lines = raw.split(/\r?\n/);

  let inPackage = false;
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }

    if (inPackage && /^\[/.test(line)) {
      break;
    }

    if (inPackage) {
      const m = line.match(/^version\s*=\s*"[^"]*"(.*)$/);
      if (m) {
        lines[i] = `version = "${version}"${m[1] ?? ""}`;
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    throw new Error(`No [package] version field found in ${filePathForError}`);
  }

  return lines.join("\n");
}

function writeFileIfChanged(filePath, nextContent, { dryRun }) {
  const prevContent = fs.readFileSync(filePath, "utf8");
  if (prevContent === nextContent) return false;
  if (!dryRun) fs.writeFileSync(filePath, nextContent, "utf8");
  return true;
}

function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function generateReleaseNotes({ version, previousTag }) {
  const tag = `v${version}`;
  const args = [path.join("scripts", "generate-release-notes.mjs"), tag, "--format=bilingual"];
  if (previousTag) args.splice(2, 0, previousTag);

  return execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertSemver(opts.version);

  const root = process.cwd();

  const packageJsonPath = path.join(root, "package.json");
  const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
  const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");

  const packageJsonNext = ensureTrailingNewline(
    replaceFirstJsonVersion(fs.readFileSync(packageJsonPath, "utf8"), opts.version, "package.json"),
  );
  const cargoTomlNext = ensureTrailingNewline(
    replaceCargoPackageVersion(fs.readFileSync(cargoTomlPath, "utf8"), opts.version, "src-tauri/Cargo.toml"),
  );
  const tauriConfNext = ensureTrailingNewline(
    replaceFirstJsonVersion(fs.readFileSync(tauriConfPath, "utf8"), opts.version, "src-tauri/tauri.conf.json"),
  );

  const changed = [];
  if (writeFileIfChanged(packageJsonPath, packageJsonNext, opts)) changed.push("package.json");
  if (writeFileIfChanged(cargoTomlPath, cargoTomlNext, opts)) changed.push("src-tauri/Cargo.toml");
  if (writeFileIfChanged(tauriConfPath, tauriConfNext, opts)) changed.push("src-tauri/tauri.conf.json");

  const changedLabel = changed.length === 0 ? "(no changes)" : changed.join(", ");
  process.stdout.write(`Set version to ${opts.version}: ${changedLabel}\n`);

  if (opts.notes) {
    const notesPath = path.join(root, "releases", `v${opts.version}.md`);
    if (fs.existsSync(notesPath) && !opts.force) {
      process.stderr.write(`ERROR: ${path.relative(root, notesPath)} already exists. Use --force to overwrite.\n`);
      process.exit(2);
    }

    const notes = generateReleaseNotes({ version: opts.version, previousTag: opts.notesPrev });

    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(notesPath), { recursive: true });
      fs.writeFileSync(notesPath, ensureTrailingNewline(notes), "utf8");
    }
    process.stdout.write(
      `${opts.dryRun ? "Would write" : "Wrote"} release notes draft: ${path.relative(root, notesPath)}\n`,
    );
  }
}

main();
