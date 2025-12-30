#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROBE_TIMEOUT_MS = 30_000;
const STEP_CLOSE_GRACE_MS = 5_000;

function parseArgs(argv) {
  const out = {
    frontendPlatform: "auto", // auto | windows | linux
    rustPlatform: "auto", // auto | windows | linux | both
    rustTests: "dedup", // dedup | full
    rustTargetDir: "auto", // auto | workspace
    rustTestThreads: "auto", // auto | <positive int>
    includePlaywright: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/check-all.mjs [--frontend-platform auto|windows|linux]",
          "                               [--rust-platform auto|windows|linux|both]",
          "                               [--rust-tests dedup|full]",
          "                               [--rust-target-dir auto|workspace]",
          "                               [--rust-test-threads auto|N]",
          "                               [--include-playwright=0|1]",
          "",
          "Notes:",
          "- Frontend build/tests run once (host platform).",
          "- Rust checks can run on Windows and/or Linux depending on host + availability.",
          "- rust-tests=dedup runs the full Rust test suite once (on the primary platform) and runs only platform-only tests on the non-primary platform.",
          "- rust-tests=full runs the full Rust test suite on every selected Rust platform (previous behavior).",
          "- rust-platform=both requires both platforms to be runnable on this host.",
          "- Rust artifacts MUST stay under the repository directory. rust-target-dir=auto maps to workspace.",
          "- rust-test-threads controls Rust libtest thread count (auto uses 1).",
          "- include-playwright=1 enables optional Playwright smoke checks (may generate screenshot artifacts).",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    const fp = arg.match(/^--frontend-platform=(.+)$/);
    if (fp) out.frontendPlatform = fp[1];

    const m = arg.match(/^--rust-platform=(.+)$/);
    if (m) out.rustPlatform = m[1];

    const rtm = arg.match(/^--rust-tests=(.+)$/);
    if (rtm) out.rustTests = rtm[1];

    const t = arg.match(/^--rust-target-dir=(.+)$/);
    if (t) out.rustTargetDir = t[1];

    const tt = arg.match(/^--rust-test-threads=(.+)$/);
    if (tt) out.rustTestThreads = tt[1];

    const pw = arg.match(/^--include-playwright=(.+)$/);
    if (pw) out.includePlaywright = pw[1] === "1" || pw[1] === "true";
  }

  if (!["auto", "windows", "linux", "both"].includes(out.rustPlatform)) {
    process.stderr.write(`ERROR: Invalid --rust-platform value: ${out.rustPlatform}\n`);
    process.exit(2);
  }

  if (!["dedup", "full"].includes(out.rustTests)) {
    process.stderr.write(`ERROR: Invalid --rust-tests value: ${out.rustTests}\n`);
    process.exit(2);
  }

  if (!["auto", "windows", "linux"].includes(out.frontendPlatform)) {
    process.stderr.write(`ERROR: Invalid --frontend-platform value: ${out.frontendPlatform}\n`);
    process.exit(2);
  }

  if (!["auto", "workspace"].includes(out.rustTargetDir)) {
    process.stderr.write(`ERROR: Invalid --rust-target-dir value: ${out.rustTargetDir}\n`);
    process.exit(2);
  }

  if (out.rustTestThreads !== "auto") {
    const n = Number(out.rustTestThreads);
    if (!Number.isInteger(n) || n <= 0) {
      process.stderr.write(`ERROR: Invalid --rust-test-threads value: ${out.rustTestThreads}\n`);
      process.exit(2);
    }
    out.rustTestThreads = String(n);
  }

  return out;
}

const liveChildren = new Set();
function bestEffortKillLiveChildren() {
  for (const child of liveChildren) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

process.once("SIGINT", () => {
  bestEffortKillLiveChildren();
  process.exit(130);
});
process.once("SIGTERM", () => {
  bestEffortKillLiveChildren();
  process.exit(143);
});
process.once("exit", () => {
  bestEffortKillLiveChildren();
});

function createLinePrefixer(prefix, write) {
  let buffered = "";
  return {
    push(chunk) {
      buffered += chunk.toString("utf8");
      let idx;
      while ((idx = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, idx + 1);
        buffered = buffered.slice(idx + 1);
        write(prefix + line);
      }
    },
    flush() {
      if (!buffered) return;
      write(prefix + buffered);
      buffered = "";
    },
  };
}

async function runStep(label, command, args, options = {}) {
  process.stdout.write(`\n==> ${label}\n`);

  const { outputPrefix, ...spawnOptions } = options;

  const child = spawn(command, args, {
    ...spawnOptions,
    env: {
      ...process.env,
      ...spawnOptions.env,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });
  liveChildren.add(child);
  child.once("close", () => liveChildren.delete(child));

  child.on("error", (err) => {
    process.stderr.write(String(err));
    process.stderr.write("\n");
    process.exit(1);
  });

  const closePromise = new Promise((resolve) => child.once("close", resolve));

  const stdoutPrefixer = outputPrefix ? createLinePrefixer(outputPrefix, (s) => process.stdout.write(s)) : null;
  const stderrPrefixer = outputPrefix ? createLinePrefixer(outputPrefix, (s) => process.stderr.write(s)) : null;

  child.stdout.on("data", (chunk) => (stdoutPrefixer ? stdoutPrefixer.push(chunk) : process.stdout.write(chunk)));
  child.stderr.on("data", (chunk) => (stderrPrefixer ? stderrPrefixer.push(chunk) : process.stderr.write(chunk)));

  const code = await new Promise((resolve) => child.once("exit", resolve));
  const closed = await Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), STEP_CLOSE_GRACE_MS)),
  ]);

  stdoutPrefixer?.flush();
  stderrPrefixer?.flush();

  if (!closed) {
    process.stderr.write(`\nERROR: "${label}" exited but its stdio did not close within ${STEP_CLOSE_GRACE_MS}ms.\n`);
    process.stderr.write(
      "Hint: A background process likely kept stdout/stderr open. Run the command standalone to find the process that does not exit.\n",
    );
    process.exit(1);
  }

  if (code !== 0) {
    process.stderr.write(`\nERROR: "${label}" failed with exit code ${code}.\n`);
    process.exit(code ?? 1);
  }
}

async function runStepCaptureStdout(label, command, args, options = {}) {
  process.stdout.write(`\n==> ${label}\n`);

  const { outputPrefix, ...spawnOptions } = options;

  const child = spawn(command, args, {
    ...spawnOptions,
    env: {
      ...process.env,
      ...spawnOptions.env,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });
  liveChildren.add(child);
  child.once("close", () => liveChildren.delete(child));

  child.on("error", (err) => {
    process.stderr.write(String(err));
    process.stderr.write("\n");
    process.exit(1);
  });

  const closePromise = new Promise((resolve) => child.once("close", resolve));

  const stdoutPrefixer = outputPrefix ? createLinePrefixer(outputPrefix, (s) => process.stdout.write(s)) : null;
  const stderrPrefixer = outputPrefix ? createLinePrefixer(outputPrefix, (s) => process.stderr.write(s)) : null;

  let captured = "";
  child.stdout.on("data", (chunk) => {
    captured += chunk.toString("utf8");
    if (stdoutPrefixer) stdoutPrefixer.push(chunk);
    else process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    if (stderrPrefixer) stderrPrefixer.push(chunk);
    else process.stderr.write(chunk);
  });

  const code = await new Promise((resolve) => child.once("exit", resolve));
  const closed = await Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), STEP_CLOSE_GRACE_MS)),
  ]);

  stdoutPrefixer?.flush();
  stderrPrefixer?.flush();

  if (!closed) {
    process.stderr.write(`\nERROR: "${label}" exited but its stdio did not close within ${STEP_CLOSE_GRACE_MS}ms.\n`);
    process.stderr.write(
      "Hint: A background process likely kept stdout/stderr open. Run the command standalone to find the process that does not exit.\n",
    );
    process.exit(1);
  }

  if (code !== 0) {
    process.stderr.write(`\nERROR: "${label}" failed with exit code ${code}.\n`);
    process.exit(code ?? 1);
  }

  return captured;
}

async function runPnpmStep(label, pnpmArgs, options = {}) {
  if (process.platform === "win32") {
    // `spawn("pnpm.cmd")` may fail with EINVAL in some Windows execution layers.
    // Running via cmd.exe keeps this step robust while preserving output piping.
    await runStep(label, "cmd.exe", ["/d", "/s", "/c", "pnpm", ...pnpmArgs], options);
    return;
  }

  await runStep(label, "pnpm", pnpmArgs, options);
}

function resolveFrontendPlatform(opts) {
  if (opts.frontendPlatform !== "auto") return opts.frontendPlatform;
  if (process.platform === "win32") return "windows";

  if (isWsl()) {
    const rollupLinux = path.join(process.cwd(), "node_modules", "@rollup", "rollup-linux-x64-gnu");
    const rollupWindows = path.join(process.cwd(), "node_modules", "@rollup", "rollup-win32-x64-msvc");
    if (!fs.existsSync(rollupLinux) && fs.existsSync(rollupWindows)) {
      return "windows";
    }
  }

  return "linux";
}

async function runFrontendPnpmStep(label, pnpmArgs, opts, options = {}) {
  const frontendPlatform = resolveFrontendPlatform(opts);
  if (frontendPlatform !== "windows") {
    await runPnpmStep(label, pnpmArgs, options);
    return;
  }

  if (process.platform === "win32") {
    await runPnpmStep(label, pnpmArgs, options);
    return;
  }

  if (process.platform === "linux" && isWsl()) {
    const windowsPnpmCmd = getWindowsPnpmCmdOnWslHost();
    if (!windowsPnpmCmd) {
      throw new Error(
        "frontend-platform=windows on WSL requires a usable Windows pnpm (pnpm.cmd via Corepack), or set frontend-platform=linux with Linux node_modules installed.",
      );
    }

    await runStep(label, "cmd.exe", ["/d", "/s", "/c", "pnpm", ...pnpmArgs], {
      ...options,
    });
    return;
  }

  throw new Error(`frontend-platform=windows requires win32 host or WSL host, got: ${process.platform}`);
}

function commandExists(command) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "where" : "which", [command], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
  });
  return result.status === 0;
}

function isWsl() {
  return process.platform === "linux" && (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME || process.env.WSLENV);
}

function wslIsUsableOnWindowsHost() {
  if (process.platform !== "win32") return false;
  if (!commandExists("wsl.exe")) return false;
  const result = spawnSync("wsl.exe", ["-e", "uname"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
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

function runCaptureFirstLine(command, args, options = {}) {
  const out = runCaptureSingleLine(command, args, options);
  if (!out) return null;
  return (
    out
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? null
  );
}

function resolveLocalCargoPath() {
  if (process.platform !== "linux") return null;
  const home = process.env.HOME;
  if (home) {
    const candidate = path.join(home, ".cargo", "bin", "cargo");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // ignore
    }
  }
  return runCaptureSingleLine("which", ["cargo"]);
}

function resolveWindowsCargoExeOnWslHost() {
  if (process.platform !== "linux" || !isWsl()) return null;

  const direct = runCaptureFirstLine("which", ["cargo.exe"]);
  if (direct) return direct;

  const windowsPath = runCaptureFirstLine("where.exe", ["cargo.exe"]);
  if (!windowsPath) return null;

  const wslPath = runCaptureFirstLine("wslpath", ["-u", "-a", windowsPath]);
  return wslPath;
}

function resolveWindowsPnpmCmdOnWslHost() {
  if (process.platform !== "linux" || !isWsl()) return null;

  const pnpmCmdWin = runCaptureFirstLine("where.exe", ["pnpm.cmd"]);
  if (!pnpmCmdWin) return null;
  const pnpmCmdWsl = runCaptureFirstLine("wslpath", ["-u", "-a", pnpmCmdWin]);
  if (!pnpmCmdWsl) return null;
  if (!fs.existsSync(pnpmCmdWsl)) return null;
  return pnpmCmdWsl;
}

let cachedWindowsPnpmCmdOnWslHost;
let cachedWindowsPnpmCmdOnWslHostResolved = false;
function getWindowsPnpmCmdOnWslHost() {
  if (cachedWindowsPnpmCmdOnWslHostResolved) return cachedWindowsPnpmCmdOnWslHost;
  cachedWindowsPnpmCmdOnWslHostResolved = true;
  cachedWindowsPnpmCmdOnWslHost = resolveWindowsPnpmCmdOnWslHost();
  return cachedWindowsPnpmCmdOnWslHost;
}

function resolveWslCargoPathOnWindowsHost() {
  if (process.platform !== "win32") return null;
  if (!wslIsUsableOnWindowsHost()) return null;
  const script = [
    'if [ -x "$HOME/.cargo/bin/cargo" ]; then',
    '  echo "$HOME/.cargo/bin/cargo";',
    "elif command -v cargo >/dev/null 2>&1; then",
    "  command -v cargo;",
    "fi",
  ].join(" ");
  return runCaptureSingleLine("wsl.exe", ["-e", "sh", "-c", script]);
}

function windowsPathToWslPath(winPath) {
  if (process.platform !== "win32") {
    throw new Error(`windowsPathToWslPath() requires win32 host, got: ${process.platform}`);
  }
  const result = spawnSync("wsl.exe", ["-e", "wslpath", "-u", "-a", winPath], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`wslpath timed out after ${PROBE_TIMEOUT_MS}ms`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(`wslpath failed (exit=${result.status}): ${stderr}`.trim());
  }
  return String(result.stdout ?? "").trim();
}

function wslPathToWindowsPath(wslPath) {
  if (process.platform !== "linux") {
    throw new Error(`wslPathToWindowsPath() requires linux host, got: ${process.platform}`);
  }
  const result = spawnSync("wslpath", ["-w", "-a", wslPath], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`wslpath timed out after ${PROBE_TIMEOUT_MS}ms`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(`wslpath failed (exit=${result.status}): ${stderr}`.trim());
  }
  return String(result.stdout ?? "").trim();
}

function appendWslenvToken(existing, token) {
  if (!existing) return token;
  const parts = existing.split(":").filter(Boolean);
  if (parts.some((p) => p.split("/")[0].toUpperCase() === token.toUpperCase())) return existing;
  return `${existing}:${token}`;
}

function resolveCargoEnv(extra = {}) {
  return {
    CARGO_INCREMENTAL: "0",
    CARGO_TERM_COLOR: "never",
    ...extra,
  };
}

function resolveRustTestArgs(opts) {
  if (opts.rustTestThreads === "auto") {
    return ["--", "--test-threads=1"];
  }
  return ["--", `--test-threads=${opts.rustTestThreads}`];
}

function stripAnsi(text) {
  // libtest output may include ANSI color codes; stripping them keeps parsing deterministic.
  // eslint-disable-next-line no-control-regex
  return String(text).replaceAll(/\u001b\[[0-9;]*m/g, "");
}

function parseLibtestListOutput(stdoutText) {
  const names = new Set();
  const lines = stripAnsi(stdoutText).replaceAll("\r", "").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const m = line.match(/^(.+): (test|benchmark)$/);
    if (!m) continue;
    names.add(m[1].trim());
  }
  return names;
}

async function runRustFmtCheck(platform, rustRootDir, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        "Rust formatting (rustfmt --check)",
        cargo,
        ["fmt", "--manifest-path", rustCargoToml, "--", "--check"],
        { env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) {
        throw new Error("Rust formatting check (Linux) on Windows requires WSL (wsl.exe).");
      }

      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo for rustfmt. Install rustup inside WSL so $HOME/.cargo/bin/cargo exists.",
        );
      }

      await runStep(
        "Rust formatting (rustfmt --check, Linux/WSL)",
        "wsl.exe",
        [
          "-e",
          "env",
          "CARGO_INCREMENTAL=0",
          "CARGO_TERM_COLOR=never",
          wslCargo,
          "fmt",
          "--manifest-path",
          wslCargoToml,
          "--",
          "--check",
        ],
        runOptions,
      );
      return;
    }

    throw new Error(`Unsupported host for Linux rustfmt check: ${process.platform}`);
  }

  if (platform === "windows") {
    if (process.platform === "win32") {
      await runStep(
        "Rust formatting (rustfmt --check)",
        "cargo",
        ["fmt", "--manifest-path", rustCargoToml, "--", "--check"],
        { env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) {
        throw new Error("Rust formatting check (Windows) requires a Windows host or WSL.");
      }

      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows rustfmt check requires access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }

      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");

      await runStep(
        "Rust formatting (rustfmt --check, Windows via cargo.exe)",
        cargoExe,
        ["fmt", "--manifest-path", winCargoToml, "--", "--check"],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for Windows rustfmt check: ${process.platform}`);
  }

  throw new Error(`Unknown rustfmt platform: ${platform}`);
}

function resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, _opts) {
  const workspaceTarget = path.posix.join(path.posix.dirname(wslCargoToml), "target", "linux");

  return workspaceTarget;
}

async function runRustChecksForPlatform(platform, rustRootDir, opts, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");
  const testArgs = resolveRustTestArgs(opts);

  if (platform === "windows") {
    if (process.platform === "win32") {
      // Keep host (Windows) and Linux/WSL builds isolated to avoid clobbering
      // artifacts when both platforms share the same workspace/target directory.
      await runStep(
        "Rust tests (Windows)",
        "cargo",
        ["test", "--profile", "check-all", "--target-dir", "target/win", ...testArgs],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
          ...runOptions,
        },
      );
      await runStep(
        "Rust clippy (Windows, deny warnings)",
        "cargo",
        ["clippy", "--profile", "check-all", "--target-dir", "target/win", "--no-deps", "--", "-D", "warnings"],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
          ...runOptions,
        },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) {
        throw new Error("Windows Rust checks require a Windows host or WSL.");
      }

      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");

      await runStep(
        "Rust tests (Windows via cargo.exe)",
        cargoExe,
        ["test", "--profile", "check-all", "--target-dir", winTargetDir, "--manifest-path", winCargoToml, ...testArgs],
        {
          env: resolveCargoEnv({ WSLENV: wslenv }),
          ...runOptions,
        },
      );
      await runStep(
        "Rust clippy (Windows via cargo.exe, deny warnings)",
        cargoExe,
        [
          "clippy",
          "--profile",
          "check-all",
          "--target-dir",
          winTargetDir,
          "--manifest-path",
          winCargoToml,
          "--no-deps",
          "--",
          "-D",
          "warnings",
        ],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      const targetDir = "target/linux";
      await runStep(
        "Rust tests (Linux)",
        cargo,
        ["test", "--profile", "check-all", "--target-dir", targetDir, ...testArgs],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
          ...runOptions,
        },
      );
      await runStep(
        "Rust clippy (Linux, deny warnings)",
        cargo,
        ["clippy", "--profile", "check-all", "--target-dir", targetDir, "--no-deps", "--", "-D", "warnings"],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
          ...runOptions,
        },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) {
        throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      }

      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      await runStep(
        "Rust tests (Linux/WSL)",
        "wsl.exe",
        [
          "-e",
          "env",
          "CARGO_INCREMENTAL=0",
          "CARGO_TERM_COLOR=never",
          wslCargo,
          "test",
          "--profile",
          "check-all",
          "--target-dir",
          wslTargetDir,
          "--manifest-path",
          wslCargoToml,
          ...testArgs,
        ],
        runOptions,
      );
      await runStep(
        "Rust clippy (Linux/WSL, deny warnings)",
        "wsl.exe",
        [
          "-e",
          "env",
          "CARGO_INCREMENTAL=0",
          "CARGO_TERM_COLOR=never",
          wslCargo,
          "clippy",
          "--profile",
          "check-all",
          "--target-dir",
          wslTargetDir,
          "--manifest-path",
          wslCargoToml,
          "--no-deps",
          "--",
          "-D",
          "warnings",
        ],
        runOptions,
      );
      return;
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

const opts = parseArgs(process.argv.slice(2));

const rustRootDir = "src-tauri";
const available = {
  windows:
    process.platform === "win32"
      ? commandExists("cargo")
      : isWsl()
        ? Boolean(resolveWindowsCargoExeOnWslHost())
        : false,
  linux:
    process.platform === "linux"
      ? commandExists("cargo")
      : process.platform === "win32"
        ? wslIsUsableOnWindowsHost() && Boolean(resolveWslCargoPathOnWindowsHost())
        : false,
};

const requested =
  opts.rustPlatform === "both"
    ? ["windows", "linux"]
    : opts.rustPlatform === "windows"
      ? ["windows"]
      : opts.rustPlatform === "linux"
        ? ["linux"]
        : ["windows", "linux"];

const selected = requested.filter((p) => available[p]);

if (selected.length === 0) {
  process.stderr.write(
    `ERROR: No Rust platforms available. requested=${requested.join(",")} host=${process.platform}\n`,
  );
  process.stderr.write(
    `Hint: On Windows host, ensure WSL is installed (wsl.exe). On Linux host, install cargo; on WSL, install Rust on Windows so cargo.exe is available.\n`,
  );
  process.exit(1);
}

if (opts.rustPlatform === "auto" && (process.platform === "win32" || isWsl()) && selected.length !== 2) {
  process.stderr.write(
    `ERROR: Both Windows and Linux Rust checks are required for check-all on this host. Available: ${selected.join(",") || "(none)"}\n`,
  );
  process.stderr.write(
    `Hint: Ensure Windows cargo is installed and reachable (cargo.exe), and ensure a Linux cargo is available (WSL rustup on Windows host, or /usr/bin/cargo on WSL).\n`,
  );
  process.exit(1);
}

if (opts.rustPlatform === "both" && selected.length !== 2) {
  process.stderr.write(`ERROR: rust-platform=both requested, but not all platforms are available on this host.\n`);
  process.stderr.write(
    `Available: ${selected.join(",") || "(none)"} | Host: ${process.platform} | WSL: ${isWsl() ? "yes" : "no"}\n`,
  );
  process.stderr.write(
    `Hint: On Windows, install/enable WSL. On WSL, install Rust on Windows so cargo.exe is available.\n`,
  );
  process.exit(1);
}

let rustFmtPlatform = selected[0];
if (process.platform === "win32") {
  rustFmtPlatform = "windows";
} else if (isWsl() && resolveWindowsCargoExeOnWslHost()) {
  rustFmtPlatform = "windows";
} else if (selected.includes("linux")) {
  rustFmtPlatform = "linux";
} else if (selected.includes("windows")) {
  rustFmtPlatform = "windows";
}

if (opts.rustTargetDir !== "auto" && opts.rustTargetDir !== "workspace") {
  process.stderr.write(`ERROR: rust-target-dir must be workspace (artifacts must stay inside the repo).\n`);
  process.exit(2);
}

function resolvePrimaryRustRuntimePlatform(selectedPlatforms) {
  if (selectedPlatforms.length === 1) return selectedPlatforms[0];
  if (process.platform === "win32") return "windows";
  if (isWsl() && resolveWindowsCargoExeOnWslHost()) return "windows";
  if (selectedPlatforms.includes("linux")) return "linux";
  return "windows";
}

async function runRustClippyForPlatform(platform, rustRootDir, opts, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "windows") {
    if (process.platform === "win32") {
      await runStep(
        "Rust clippy (Windows, deny warnings)",
        "cargo",
        ["clippy", "--profile", "check-all", "--target-dir", "target/win", "--no-deps", "--", "-D", "warnings"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) throw new Error("Windows Rust checks require a Windows host or WSL.");
      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");
      await runStep(
        "Rust clippy (Windows via cargo.exe, deny warnings)",
        cargoExe,
        [
          "clippy",
          "--profile",
          "check-all",
          "--target-dir",
          winTargetDir,
          "--manifest-path",
          winCargoToml,
          "--no-deps",
          "--",
          "-D",
          "warnings",
        ],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        "Rust clippy (Linux, deny warnings)",
        cargo,
        ["clippy", "--profile", "check-all", "--target-dir", "target/linux", "--no-deps", "--", "-D", "warnings"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      await runStep("Rust clippy (Linux/WSL, deny warnings)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        "CARGO_TERM_COLOR=never",
        wslCargo,
        "clippy",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
        "--no-deps",
        "--",
        "-D",
        "warnings",
      ]);
      return;
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

async function runRustTestNoRunForPlatform(platform, rustRootDir, opts, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "windows") {
    if (process.platform === "win32") {
      await runStep(
        "Rust tests (Windows, no-run)",
        "cargo",
        ["test", "--profile", "check-all", "--target-dir", "target/win", "--no-run"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) throw new Error("Windows Rust checks require a Windows host or WSL.");
      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");
      await runStep(
        "Rust tests (Windows via cargo.exe, no-run)",
        cargoExe,
        ["test", "--profile", "check-all", "--target-dir", winTargetDir, "--manifest-path", winCargoToml, "--no-run"],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        "Rust tests (Linux, no-run)",
        cargo,
        ["test", "--profile", "check-all", "--target-dir", "target/linux", "--no-run"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      await runStep("Rust tests (Linux/WSL, no-run)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        "CARGO_TERM_COLOR=never",
        wslCargo,
        "test",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
        "--no-run",
      ]);
      return;
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

async function runRustTestListForPlatform(platform, rustRootDir, opts, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "windows") {
    if (process.platform === "win32") {
      const stdout = await runStepCaptureStdout(
        "Rust tests list (Windows)",
        "cargo",
        ["test", "--profile", "check-all", "--target-dir", "target/win", "--", "--list"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return parseLibtestListOutput(stdout);
    }

    if (process.platform === "linux") {
      if (!isWsl()) throw new Error("Windows Rust checks require a Windows host or WSL.");
      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");
      const stdout = await runStepCaptureStdout(
        "Rust tests list (Windows via cargo.exe)",
        cargoExe,
        [
          "test",
          "--profile",
          "check-all",
          "--target-dir",
          winTargetDir,
          "--manifest-path",
          winCargoToml,
          "--",
          "--list",
        ],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return parseLibtestListOutput(stdout);
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      const stdout = await runStepCaptureStdout(
        "Rust tests list (Linux)",
        cargo,
        ["test", "--profile", "check-all", "--target-dir", "target/linux", "--", "--list"],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return parseLibtestListOutput(stdout);
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      const stdout = await runStepCaptureStdout("Rust tests list (Linux/WSL)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        "CARGO_TERM_COLOR=never",
        wslCargo,
        "test",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
        "--",
        "--list",
      ]);
      return parseLibtestListOutput(stdout);
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

async function runRustTestFullForPlatform(platform, rustRootDir, opts, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");
  const testArgs = resolveRustTestArgs(opts);

  if (platform === "windows") {
    if (process.platform === "win32") {
      await runStep(
        "Rust tests (Windows)",
        "cargo",
        ["test", "--profile", "check-all", "--target-dir", "target/win", ...testArgs],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) throw new Error("Windows Rust checks require a Windows host or WSL.");
      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");
      await runStep(
        "Rust tests (Windows via cargo.exe)",
        cargoExe,
        ["test", "--profile", "check-all", "--target-dir", winTargetDir, "--manifest-path", winCargoToml, ...testArgs],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        "Rust tests (Linux)",
        cargo,
        ["test", "--profile", "check-all", "--target-dir", "target/linux", ...testArgs],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      await runStep("Rust tests (Linux/WSL)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        "CARGO_TERM_COLOR=never",
        wslCargo,
        "test",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
        ...testArgs,
      ]);
      return;
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

async function runRustTestExactForPlatform(platform, rustRootDir, opts, testName, runOptions = {}) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");
  const baseArgs = resolveRustTestArgs(opts);
  const libtestArgs = baseArgs[0] === "--" ? baseArgs.slice(1) : [];
  const testArgs = ["--", "--exact", ...libtestArgs];

  if (platform === "windows") {
    if (process.platform === "win32") {
      await runStep(
        `Rust platform-only test (Windows): ${testName}`,
        "cargo",
        ["test", "--profile", "check-all", "--target-dir", "target/win", testName, ...testArgs],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl()) throw new Error("Windows Rust checks require a Windows host or WSL.");
      const cargoExe = resolveWindowsCargoExeOnWslHost();
      if (!cargoExe) {
        throw new Error(
          "Windows Rust checks require access to Windows cargo.exe from WSL (install Rust on Windows and keep Windows interop enabled).",
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const winTargetDir = path.win32.join(path.win32.dirname(winCargoToml), "target", "win");
      const wslenv = appendWslenvToken(process.env.WSLENV, "CARGO_INCREMENTAL");
      await runStep(
        `Rust platform-only test (Windows via cargo.exe): ${testName}`,
        cargoExe,
        [
          "test",
          "--profile",
          "check-all",
          "--target-dir",
          winTargetDir,
          "--manifest-path",
          winCargoToml,
          testName,
          ...testArgs,
        ],
        { env: resolveCargoEnv({ WSLENV: wslenv }), ...runOptions },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        `Rust platform-only test (Linux): ${testName}`,
        cargo,
        ["test", "--profile", "check-all", "--target-dir", "target/linux", testName, ...testArgs],
        { cwd: rustRootDir, env: resolveCargoEnv(), ...runOptions },
      );
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslTargetDir = resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists.",
        );
      }
      await runStep(`Rust platform-only test (Linux/WSL): ${testName}`, "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        "CARGO_TERM_COLOR=never",
        wslCargo,
        "test",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
        testName,
        ...testArgs,
      ]);
      return;
    }

    throw new Error(`Unsupported host for linux rust checks: ${process.platform}`);
  }

  throw new Error(`Unknown rust platform: ${platform}`);
}

function setDifference(a, b) {
  const out = new Set();
  for (const item of a) {
    if (!b.has(item)) out.add(item);
  }
  return out;
}

async function runRustChecksDedup(selectedPlatforms, rustRootDir, opts, runOptions = {}) {
  const primary = resolvePrimaryRustRuntimePlatform(selectedPlatforms);
  const nonPrimary = selectedPlatforms.find((p) => p !== primary);
  if (!nonPrimary) {
    await runRustTestFullForPlatform(primary, rustRootDir, opts, runOptions);
    await runRustClippyForPlatform(primary, rustRootDir, opts, runOptions);
    process.stdout.write(`\nRust summary: mode=dedup primary=${primary} platforms=${primary}\n`);
    return;
  }

  const [windowsList, linuxList] = await Promise.all([
    runRustTestListForPlatform("windows", rustRootDir, opts, runOptions),
    runRustTestListForPlatform("linux", rustRootDir, opts, runOptions),
  ]);

  const windowsOnly = setDifference(windowsList, linuxList);
  const linuxOnly = setDifference(linuxList, windowsList);

  await runRustTestFullForPlatform(primary, rustRootDir, opts, runOptions);
  await runRustTestNoRunForPlatform(nonPrimary, rustRootDir, opts, runOptions);

  const onlyToRun = nonPrimary === "windows" ? windowsOnly : linuxOnly;
  const onlySorted = Array.from(onlyToRun).sort((a, b) => a.localeCompare(b));
  for (const testName of onlySorted) {
    await runRustTestExactForPlatform(nonPrimary, rustRootDir, opts, testName, runOptions);
  }

  await runRustClippyForPlatform("windows", rustRootDir, opts, runOptions);
  await runRustClippyForPlatform("linux", rustRootDir, opts, runOptions);

  process.stdout.write(
    [
      "",
      "Rust summary:",
      `- mode=dedup primary=${primary}`,
      `- windows tests=${windowsList.size} windows-only=${windowsOnly.size}`,
      `- linux tests=${linuxList.size} linux-only=${linuxOnly.size}`,
      `- non-primary executed=${onlyToRun.size} (${nonPrimary})`,
      "",
    ].join("\n"),
  );
}

async function runRustChecks(selectedPlatforms, rustRootDir, opts, runOptions = {}) {
  if (opts.rustTests === "full" || selectedPlatforms.length < 2) {
    for (const platform of selectedPlatforms) {
      await runRustChecksForPlatform(platform, rustRootDir, opts, runOptions);
    }
    process.stdout.write(`\nRust summary: mode=full platforms=${selectedPlatforms.join(",") || "(none)"}\n`);
    return;
  }

  await runRustChecksDedup(selectedPlatforms, rustRootDir, opts, runOptions);
}

async function runParallel(tasks) {
  await Promise.all(tasks.map((t) => t()));
}

const parallel = [
  () =>
    runFrontendPnpmStep("Frontend formatting (prettier --check)", ["run", "format:check:frontend"], opts, {
      outputPrefix: "[prettier] ",
    }),
  () =>
    runFrontendPnpmStep("Frontend lint (eslint)", ["run", "lint"], opts, {
      outputPrefix: "[eslint] ",
    }),
  () =>
    runFrontendPnpmStep("i18n key check", ["run", "check:i18n"], opts, {
      outputPrefix: "[i18n] ",
    }),
  () =>
    runFrontendPnpmStep("Duplicate check (frontend, jscpd)", ["run", "dup:frontend"], opts, {
      outputPrefix: "[jscpd:fe] ",
    }),
  () =>
    runFrontendPnpmStep("Duplicate check (Rust, jscpd)", ["run", "dup:rust"], opts, {
      outputPrefix: "[jscpd:rs] ",
    }),
  async () => {
    await runFrontendPnpmStep("Frontend build (vue-tsc + vite)", ["run", "build"], opts, { outputPrefix: "[build] " });
    await runFrontendPnpmStep("Frontend tests (vitest run)", ["run", "test"], opts, { outputPrefix: "[vitest] " });
  },
  async () => {
    await runRustFmtCheck(rustFmtPlatform, rustRootDir, { outputPrefix: "[rustfmt] " });
    await runRustChecks(selected, rustRootDir, opts, { outputPrefix: "[rust] " });
  },
];

await runParallel(parallel);

await runFrontendPnpmStep("Queue perf benches (vitest perf suite)", ["run", "bench:queue"], opts);

if (opts.includePlaywright) {
  await runFrontendPnpmStep(
    "Queue large list screenshot smoke (Playwright)",
    ["run", "docs:screenshots:queue-large"],
    opts,
  );
}
