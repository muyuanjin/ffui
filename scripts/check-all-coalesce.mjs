#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Coalesces concurrent check:all runs:
// - Serializes execution via a lock directory under `.cache` so Windows + WSL runs are mutually exclusive.
// - Reuses a cached exit code when the repo state + argv fingerprint matches.
// - Set FFUI_CHECK_ALL_COALESCE_FORCE=1 to bypass the cache (still serialized).

const PROBE_TIMEOUT_MS = 30_000;

const COALESCE_FORCE_ENV = "FFUI_CHECK_ALL_COALESCE_FORCE";

function commandExists(command) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "where" : "which", [command], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
  });
  return result.status === 0;
}

function runCaptureSingleLine(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    timeout: options.timeout ?? PROBE_TIMEOUT_MS,
  });
  if (result.status !== 0) return null;
  const out = String(result.stdout ?? "")
    .replaceAll("\r", "")
    .trim();
  return out ? out : null;
}

function sha256HexFromString(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function sha256HexOfCommandStdout(command, args, options = {}) {
  const hash = crypto.createHash("sha256");
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "ignore"] });

  child.stdout.on("data", (chunk) => hash.update(chunk));

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (exitCode !== 0) return null;
  return hash.digest("hex");
}

async function sha256HexOfFile(absPath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function shouldIncludeUntracked(relPath) {
  const p = relPath.replaceAll("\\", "/");
  if (p.startsWith("src/")) return true;
  if (p.startsWith("src-tauri/")) return true;
  if (p.startsWith("scripts/")) return true;
  if (p.startsWith("tools/")) return true;
  const ext = path.extname(p).toLowerCase();
  return [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".json",
    ".mjs",
    ".cjs",
    ".rs",
    ".toml",
    ".lock",
    ".yml",
    ".yaml",
    ".css",
    ".scss",
    ".md",
    ".html",
  ].includes(ext);
}

async function computeRepoFingerprint(repoRoot, argv) {
  if (!commandExists("git")) return null;

  try {
    const head = runCaptureSingleLine("git", ["rev-parse", "HEAD"], { cwd: repoRoot }) ?? "NO_HEAD";
    const diffCached = await sha256HexOfCommandStdout(
      "git",
      ["diff", "--cached", "--patch", "--no-color", "--no-ext-diff"],
      { cwd: repoRoot },
    );
    const diffWorking = await sha256HexOfCommandStdout("git", ["diff", "--patch", "--no-color", "--no-ext-diff"], {
      cwd: repoRoot,
    });
    if (!diffCached || !diffWorking) return null;

    const untrackedRes = spawnSync("git", ["ls-files", "-o", "--exclude-standard", "-z"], {
      cwd: repoRoot,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (untrackedRes.status !== 0) return null;

    const untrackedPaths = String(untrackedRes.stdout ?? "")
      .split("\u0000")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(shouldIncludeUntracked)
      .sort((a, b) => a.localeCompare(b));

    const untrackedHash = crypto.createHash("sha256");
    for (const relPath of untrackedPaths) {
      const absPath = path.join(repoRoot, relPath);
      let st;
      try {
        st = fs.statSync(absPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      // Large untracked files are unlikely to affect check:all; skip to keep hashing fast.
      if (st.size > 20 * 1024 * 1024) continue;

      untrackedHash.update(relPath);
      untrackedHash.update("\u0000");
      untrackedHash.update(await sha256HexOfFile(absPath));
      untrackedHash.update("\n");
    }

    const payload = JSON.stringify({
      argv,
      host: {
        platform: process.platform,
        node: process.version,
      },
      git: {
        head,
        diffCached,
        diffWorking,
        untracked: untrackedHash.digest("hex"),
      },
    });
    return sha256HexFromString(payload);
  } catch {
    return null;
  }
}

function coalescePaths(repoRoot) {
  const root = path.join(repoRoot, ".cache", "check-all", "coalesce");
  const lockDir = path.join(root, "check-all.lockdir");
  const resultsDir = path.join(root, "results");
  return { root, lockDir, resultsDir };
}

function readCachedExitCode(resultPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.exitCode !== "number") return null;
    return parsed.exitCode;
  } catch {
    return null;
  }
}

function readCachedReplayFile(resultPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.replayFile !== "string" || !parsed.replayFile) return null;
    return parsed.replayFile;
  } catch {
    return null;
  }
}

function writeCachedResult(resultPath, payload) {
  try {
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") return false;
    throw err;
  }
}

function formatRunId(date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${process.pid}`;
}

function writeChunkRecord(fd, streamId, buf) {
  const header = Buffer.allocUnsafe(5);
  header[0] = streamId;
  header.writeUInt32BE(buf.length, 1);
  fs.writeSync(fd, header);
  fs.writeSync(fd, buf);
}

function replayRecordedOutput(absReplayFile) {
  const fd = fs.openSync(absReplayFile, "r");
  try {
    const header = Buffer.allocUnsafe(5);
    for (;;) {
      const n = fs.readSync(fd, header, 0, 5, null);
      if (n === 0) break;
      if (n !== 5) break;
      const streamId = header[0];
      const len = header.readUInt32BE(1);
      if (!Number.isFinite(len) || len < 0 || len > 64 * 1024 * 1024) break;
      const buf = Buffer.allocUnsafe(len);
      let off = 0;
      while (off < len) {
        const got = fs.readSync(fd, buf, off, len - off, null);
        if (got <= 0) return;
        off += got;
      }
      if (streamId === 1) process.stdout.write(buf);
      else if (streamId === 2) process.stderr.write(buf);
      else process.stdout.write(buf);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function findLatestLogDir(repoRoot) {
  const logsRoot = path.join(repoRoot, ".cache", "check-all", "logs");
  let entries;
  try {
    entries = fs.readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  let best = null;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const abs = path.join(logsRoot, ent.name);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!best || st.mtimeMs > best.mtimeMs) best = { name: ent.name, mtimeMs: st.mtimeMs };
  }
  return best ? path.join(".cache", "check-all", "logs", best.name) : null;
}

function resolveBestCachedResultPath(repoRoot, resultsDir, fingerprint) {
  let entries;
  try {
    entries = fs.readdirSync(resultsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (name === `${fingerprint}.json` || (name.startsWith(`${fingerprint}.`) && name.endsWith(".json"))) {
      candidates.push(name);
    }
  }

  const scored = [];
  for (const name of candidates) {
    const abs = path.join(resultsDir, name);
    const exitCode = readCachedExitCode(abs);
    if (exitCode === null) continue;
    const replayFile = readCachedReplayFile(abs);
    if (!replayFile) continue;
    const absReplayFile = path.isAbsolute(replayFile) ? replayFile : path.join(repoRoot, replayFile);
    if (!fs.existsSync(absReplayFile)) continue;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    scored.push({ abs, exitCode, absReplayFile, mtimeMs: st.mtimeMs });
  }

  scored.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return scored[0] ?? null;
}

function readLockOwner(lockDir) {
  const ownerPath = path.join(lockDir, "owner.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const pid = Number(parsed.pid);
    const startedAtMs = Number(parsed.startedAtMs);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return null;
    return { pid, startedAtMs };
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLockOwner(lockDir) {
  const ownerPath = path.join(lockDir, "owner.json");
  fs.writeFileSync(ownerPath, `${JSON.stringify({ pid: process.pid, startedAtMs: Date.now() }, null, 2)}\n`, {
    flag: "wx",
  });
}

function tryAcquireLockDir(lockDir) {
  try {
    fs.mkdirSync(lockDir, { recursive: false });
    writeLockOwner(lockDir);
    return () => {
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") return null;
    throw err;
  }
}

async function acquireLockDirBlocking(lockDir) {
  for (;;) {
    const release = tryAcquireLockDir(lockDir);
    if (release) return release;

    const owner = readLockOwner(lockDir);
    const now = Date.now();

    if (owner && !isPidAlive(owner.pid) && now - owner.startedAtMs > 30_000) {
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    await new Promise((r) => setTimeout(r, 200));
  }
}

function listReplayFilesForFingerprint(resultsDir, fingerprint, minMtimeMs = 0) {
  let entries;
  try {
    entries = fs.readdirSync(resultsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  const prefix = `${fingerprint}.`;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.startsWith(prefix) || !ent.name.endsWith(".replay.bin")) continue;
    const abs = path.join(resultsDir, ent.name);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.mtimeMs < minMtimeMs) continue;
    out.push({ abs, mtimeMs: st.mtimeMs });
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

async function followReplayFileUntilDone(repoRoot, resultsDir, lockDir, fingerprint, absReplayFile) {
  const fd = fs.openSync(absReplayFile, "r");
  let pos = 0;

  try {
    for (;;) {
      const done = resolveBestCachedResultPath(repoRoot, resultsDir, fingerprint);

      let size = 0;
      try {
        size = fs.statSync(absReplayFile).size;
      } catch {
        size = 0;
      }

      const headerPos = pos;
      if (headerPos + 5 > size) {
        if (done && done.absReplayFile === absReplayFile) {
          process.exit(done.exitCode);
        }
        if (!fs.existsSync(lockDir) && (!done || done.absReplayFile !== absReplayFile)) return null;
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const header = Buffer.allocUnsafe(5);
      const n = fs.readSync(fd, header, 0, 5, headerPos);
      if (n !== 5) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const streamId = header[0];
      const len = header.readUInt32BE(1);
      if (!Number.isFinite(len) || len < 0 || len > 64 * 1024 * 1024) return null;

      const bodyPos = headerPos + 5;
      if (bodyPos + len > size) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const buf = Buffer.allocUnsafe(len);
      const got = fs.readSync(fd, buf, 0, len, bodyPos);
      if (got !== len) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      if (streamId === 1) process.stdout.write(buf);
      else if (streamId === 2) process.stderr.write(buf);
      else process.stdout.write(buf);

      pos = bodyPos + len;

      if (done && done.absReplayFile === absReplayFile) {
        try {
          const nowSize = fs.statSync(absReplayFile).size;
          if (pos >= nowSize) process.exit(done.exitCode);
        } catch {
          process.exit(done.exitCode);
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

const argv = process.argv.slice(2);
const repoRoot = process.cwd();

const { lockDir, resultsDir } = coalescePaths(repoRoot);
fs.mkdirSync(resultsDir, { recursive: true });

const force = process.env[COALESCE_FORCE_ENV] === "1";
const preFingerprint = force ? null : await computeRepoFingerprint(repoRoot, argv);
const tryReleaseLock = tryAcquireLockDir(lockDir);

if (!tryReleaseLock) {
  if (preFingerprint) {
    const cached = resolveBestCachedResultPath(repoRoot, resultsDir, preFingerprint);
    if (cached) {
      replayRecordedOutput(cached.absReplayFile);
      process.exit(cached.exitCode);
    }

    for (;;) {
      const owner = readLockOwner(lockDir);
      const now = Date.now();
      if (owner && !isPidAlive(owner.pid) && now - owner.startedAtMs > 30_000) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }

      if (!fs.existsSync(lockDir)) break;

      const done = resolveBestCachedResultPath(repoRoot, resultsDir, preFingerprint);
      if (done) {
        replayRecordedOutput(done.absReplayFile);
        process.exit(done.exitCode);
      }

      if (owner) {
        const replayCandidates = listReplayFilesForFingerprint(resultsDir, preFingerprint, owner.startedAtMs - 1_000);
        if (replayCandidates.length > 0) {
          await followReplayFileUntilDone(repoRoot, resultsDir, lockDir, preFingerprint, replayCandidates[0].abs);
        }
      }

      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    while (fs.existsSync(lockDir)) await new Promise((r) => setTimeout(r, 200));
  }
}

const releaseLock = tryReleaseLock ?? (await acquireLockDirBlocking(lockDir));
process.once("exit", () => releaseLock());
process.once("SIGINT", () => {
  releaseLock();
  process.exit(130);
});
process.once("SIGTERM", () => {
  releaseLock();
  process.exit(143);
});

const fingerprint = force ? null : await computeRepoFingerprint(repoRoot, argv);

if (!force && fingerprint) {
  const best = resolveBestCachedResultPath(repoRoot, resultsDir, fingerprint);
  if (best) {
    replayRecordedOutput(best.absReplayFile);
    process.exit(best.exitCode);
  }
}

const checkAllScript = path.join(repoRoot, "scripts", "check-all.mjs");
const runId = fingerprint ? formatRunId(new Date()) : null;
const replayAbs = fingerprint ? path.join(resultsDir, `${fingerprint}.${runId}.replay.bin`) : null;
const replayRel = replayAbs ? path.relative(repoRoot, replayAbs).replaceAll("\\", "/") : null;
const replayFd = replayAbs ? fs.openSync(replayAbs, "wx") : null;

const child = spawn(process.execPath, [checkAllScript, ...argv], {
  cwd: repoRoot,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (replayFd) writeChunkRecord(replayFd, 1, chunk);
});
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  if (replayFd) writeChunkRecord(replayFd, 2, chunk);
});

child.once("error", (err) => {
  if (replayFd) fs.closeSync(replayFd);
  process.stderr.write(String(err));
  process.stderr.write("\n");
  process.exit(1);
});

const exitCode = await new Promise((resolve) => {
  child.once("close", (code, _signal) => resolve(code ?? 1));
});

if (replayFd) fs.closeSync(replayFd);

if (!force && fingerprint) {
  const primaryResultPath = path.join(resultsDir, `${fingerprint}.json`);
  const fallbackResultPath = path.join(resultsDir, `${fingerprint}.${runId}.json`);
  const logDir = findLatestLogDir(repoRoot);
  const payload = {
    fingerprint,
    argv,
    exitCode,
    createdAt: new Date().toISOString(),
    host: { platform: process.platform, node: process.version },
    logDir,
    replayFile: replayRel,
  };

  const wrotePrimary = writeCachedResult(primaryResultPath, payload);
  if (!wrotePrimary) writeCachedResult(fallbackResultPath, payload);
}

process.exit(exitCode);
