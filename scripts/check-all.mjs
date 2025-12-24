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
    rustTargetDir: "auto", // auto | workspace | cache
    rustTestThreads: "auto", // auto | <positive int>
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/check-all.mjs [--frontend-platform auto|windows|linux]",
          "                               [--rust-platform auto|windows|linux|both]",
          "                               [--rust-target-dir auto|workspace|cache]",
          "                               [--rust-test-threads auto|N]",
          "",
          "Notes:",
          "- Frontend build/tests run once (host platform).",
          "- Rust checks can run on Windows and/or Linux depending on host + availability.",
          "- rust-platform=both requires both platforms to be runnable on this host.",
          "- rust-target-dir=cache stores Linux Rust artifacts under XDG_CACHE_HOME (useful on WSL when the repo lives on /mnt/<drive>).",
          "- rust-test-threads controls Rust libtest thread count (auto uses 1).",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    const fp = arg.match(/^--frontend-platform=(.+)$/);
    if (fp) out.frontendPlatform = fp[1];

    const m = arg.match(/^--rust-platform=(.+)$/);
    if (m) out.rustPlatform = m[1];

    const t = arg.match(/^--rust-target-dir=(.+)$/);
    if (t) out.rustTargetDir = t[1];

    const tt = arg.match(/^--rust-test-threads=(.+)$/);
    if (tt) out.rustTestThreads = tt[1];
  }

  if (!["auto", "windows", "linux", "both"].includes(out.rustPlatform)) {
    process.stderr.write(`ERROR: Invalid --rust-platform value: ${out.rustPlatform}\n`);
    process.exit(2);
  }

  if (!["auto", "windows", "linux"].includes(out.frontendPlatform)) {
    process.stderr.write(`ERROR: Invalid --frontend-platform value: ${out.frontendPlatform}\n`);
    process.exit(2);
  }

  if (!["auto", "workspace", "cache"].includes(out.rustTargetDir)) {
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

async function runStep(label, command, args, options = {}) {
  process.stdout.write(`\n==> ${label}\n`);

  const child = spawn(command, args, {
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    process.stderr.write(String(err));
    process.stderr.write("\n");
    process.exit(1);
  });

  const closePromise = new Promise((resolve) => child.once("close", resolve));

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  const code = await new Promise((resolve) => child.once("exit", resolve));
  const closed = await Promise.race([
    closePromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), STEP_CLOSE_GRACE_MS)),
  ]);

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

async function runNpmStep(label, npmArgs, options = {}) {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    await runStep(label, process.execPath, [npmExecPath, ...npmArgs], options);
    return;
  }

  const fallbackNpm = process.platform === "win32" ? "npm.cmd" : "npm";
  await runStep(label, fallbackNpm, npmArgs, options);
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

async function runFrontendNpmStep(label, npmArgs, opts, options = {}) {
  const frontendPlatform = resolveFrontendPlatform(opts);
  if (frontendPlatform !== "windows") {
    await runNpmStep(label, npmArgs, options);
    return;
  }

  if (process.platform === "win32") {
    await runNpmStep(label, npmArgs, options);
    return;
  }

  if (process.platform === "linux" && isWsl()) {
    const windowsNodeExe = resolveWindowsNodeExeOnWslHost();
    const windowsNpmCli = resolveWindowsNpmCliJsOnWslHost();
    if (!windowsNodeExe || !windowsNpmCli) {
      throw new Error(
        "frontend-platform=windows on WSL requires Windows Node.js (node.exe + npm-cli.js) via interop, or set frontend-platform=linux with Linux node_modules installed.",
      );
    }

    await runStep(label, windowsNodeExe, [windowsNpmCli, ...npmArgs], {
      ...options,
      cwd: path.resolve(options.cwd ?? process.cwd()),
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

function resolveCacheHome() {
  if (process.platform === "linux") {
    const cacheHome = process.env.XDG_CACHE_HOME;
    const home = process.env.HOME;
    if (cacheHome && cacheHome.trim()) return cacheHome.trim();
    if (home && home.trim()) return path.posix.join(home.trim(), ".cache");
  }
  return null;
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

function resolveWindowsNodeExeOnWslHost() {
  if (process.platform !== "linux" || !isWsl()) return null;

  const direct = runCaptureFirstLine("which", ["node.exe"]);
  if (direct) return direct;

  const windowsPath = runCaptureFirstLine("where.exe", ["node.exe"]);
  if (!windowsPath) return null;

  const wslPath = runCaptureFirstLine("wslpath", ["-u", "-a", windowsPath]);
  return wslPath;
}

function resolveWindowsNpmCliJsOnWslHost() {
  if (process.platform !== "linux" || !isWsl()) return null;

  const npmCmdWin = runCaptureFirstLine("where.exe", ["npm.cmd"]);
  if (!npmCmdWin) return null;

  const npmCliWin = path.win32.join(path.win32.dirname(npmCmdWin), "node_modules", "npm", "bin", "npm-cli.js");
  const npmCliWsl = runCaptureFirstLine("wslpath", ["-u", "-a", npmCliWin]);
  if (!npmCliWsl) return null;
  if (!fs.existsSync(npmCliWsl)) return null;
  return npmCliWin;
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

function shouldUseCacheTargetDir(opts) {
  if (opts.rustTargetDir === "cache") return true;
  if (opts.rustTargetDir === "workspace") return false;

  if (process.platform === "linux" && isWsl()) return true;
  if (process.platform === "linux" && process.cwd().startsWith("/mnt/")) return true;
  return false;
}

function resolveLinuxCacheTargetDir() {
  const cacheHome = resolveCacheHome();
  if (!cacheHome) return null;
  return path.posix.join(cacheHome, "ffui", "check-all", "cargo-target", "linux");
}

function resolveLinuxTargetDirForCargo(rustRootDir, opts) {
  if (process.platform !== "linux") return "target/linux";

  if (opts.rustTargetDir === "workspace") return "target/linux";

  const cacheTarget = resolveLinuxCacheTargetDir();
  if (opts.rustTargetDir === "cache") {
    if (!cacheTarget) return "target/linux";
    fs.mkdirSync(cacheTarget, { recursive: true });
    return cacheTarget;
  }

  if (!shouldUseCacheTargetDir(opts)) return "target/linux";
  if (!cacheTarget) return "target/linux";

  const workspaceTargetAbs = path.posix.join(process.cwd(), rustRootDir, "target", "linux");
  const workspaceParentAbs = path.posix.dirname(workspaceTargetAbs);

  try {
    const stat = fs.lstatSync(workspaceTargetAbs);
    if (stat.isSymbolicLink()) {
      return "target/linux";
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(workspaceTargetAbs);
      if (entries.length === 0) {
        fs.rmdirSync(workspaceTargetAbs);
        fs.mkdirSync(cacheTarget, { recursive: true });
        fs.symlinkSync(cacheTarget, workspaceTargetAbs, "dir");
      }
      return "target/linux";
    }
  } catch {
    // not present yet
  }

  fs.mkdirSync(workspaceParentAbs, { recursive: true });
  fs.mkdirSync(cacheTarget, { recursive: true });
  fs.symlinkSync(cacheTarget, workspaceTargetAbs, "dir");
  return "target/linux";
}

function resolveCargoEnv(extra = {}) {
  return {
    CARGO_INCREMENTAL: "0",
    ...extra,
  };
}

function resolveRustTestArgs(opts) {
  if (opts.rustTestThreads === "auto") {
    return ["--", "--test-threads=1"];
  }
  return ["--", `--test-threads=${opts.rustTestThreads}`];
}

async function runRustFmtCheck(platform, rustRootDir) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      await runStep(
        "Rust formatting (rustfmt --check)",
        cargo,
        ["fmt", "--manifest-path", rustCargoToml, "--", "--check"],
        { env: resolveCargoEnv() },
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

      await runStep("Rust formatting (rustfmt --check, Linux/WSL)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        wslCargo,
        "fmt",
        "--manifest-path",
        wslCargoToml,
        "--",
        "--check",
      ]);
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
        { env: resolveCargoEnv() },
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
        { env: resolveCargoEnv({ WSLENV: wslenv }) },
      );
      return;
    }

    throw new Error(`Unsupported host for Windows rustfmt check: ${process.platform}`);
  }

  throw new Error(`Unknown rustfmt platform: ${platform}`);
}

function resolveWslLinuxTargetDirOnWindowsHost(wslCargoToml, opts) {
  const workspaceTarget = path.posix.join(path.posix.dirname(wslCargoToml), "target", "linux");

  if (opts.rustTargetDir === "workspace") return workspaceTarget;
  if (opts.rustTargetDir === "cache") return "/tmp/ffui/check-all/cargo-target/linux";

  if (wslCargoToml.startsWith("/mnt/")) {
    return "/tmp/ffui/check-all/cargo-target/linux";
  }

  return workspaceTarget;
}

async function runRustChecksForPlatform(platform, rustRootDir, opts) {
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
        },
      );
      await runStep(
        "Rust clippy (Windows, deny warnings)",
        "cargo",
        ["clippy", "--profile", "check-all", "--target-dir", "target/win", "--", "-D", "warnings"],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
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
          "--",
          "-D",
          "warnings",
        ],
        { env: resolveCargoEnv({ WSLENV: wslenv }) },
      );
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      const targetDir = resolveLinuxTargetDirForCargo(rustRootDir, opts);
      await runStep(
        "Rust tests (Linux)",
        cargo,
        ["test", "--profile", "check-all", "--target-dir", targetDir, ...testArgs],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
        },
      );
      await runStep(
        "Rust clippy (Linux, deny warnings)",
        cargo,
        ["clippy", "--profile", "check-all", "--target-dir", targetDir, "--", "-D", "warnings"],
        {
          cwd: rustRootDir,
          env: resolveCargoEnv(),
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
      await runStep("Rust tests (Linux/WSL)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
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
      await runStep("Rust clippy (Linux/WSL, deny warnings)", "wsl.exe", [
        "-e",
        "env",
        "CARGO_INCREMENTAL=0",
        wslCargo,
        "clippy",
        "--profile",
        "check-all",
        "--target-dir",
        wslTargetDir,
        "--manifest-path",
        wslCargoToml,
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

const opts = parseArgs(process.argv.slice(2));

await runFrontendNpmStep("Frontend formatting (prettier --check)", ["run", "format:check"], opts);
await runFrontendNpmStep("Frontend build (vue-tsc + vite)", ["run", "build"], opts);
await runFrontendNpmStep("Frontend tests (vitest run)", ["run", "test"], opts);
await runFrontendNpmStep("i18n key check", ["run", "check:i18n"], opts);
await runFrontendNpmStep("Duplicate check (frontend, jscpd)", ["run", "dup:frontend"], opts);
await runFrontendNpmStep("Duplicate check (Rust, jscpd)", ["run", "dup:rust"], opts);

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

{
  let preferred = selected[0];
  if (process.platform === "win32") {
    preferred = "windows";
  } else if (isWsl() && resolveWindowsCargoExeOnWslHost()) {
    preferred = "windows";
  } else if (selected.includes("linux")) {
    preferred = "linux";
  } else if (selected.includes("windows")) {
    preferred = "windows";
  }
  await runRustFmtCheck(preferred, rustRootDir);
}

for (const platform of selected) {
  await runRustChecksForPlatform(platform, rustRootDir, opts);
}
