#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    rustPlatform: "auto", // auto | windows | linux | both
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/check-all.mjs [--rust-platform auto|windows|linux|both]",
          "",
          "Notes:",
          "- Frontend build/tests run once (host platform).",
          "- Rust checks can run on Windows and/or Linux depending on host + availability.",
          "- rust-platform=both requires both platforms to be runnable on this host.",
          "",
        ].join("\n")
      );
      process.exit(0);
    }

    const m = arg.match(/^--rust-platform=(.+)$/);
    if (m) out.rustPlatform = m[1];
  }

  if (!["auto", "windows", "linux", "both"].includes(out.rustPlatform)) {
    process.stderr.write(`ERROR: Invalid --rust-platform value: ${out.rustPlatform}\n`);
    process.exit(2);
  }

  return out;
}

function stripAnsi(text) {
  return text.replaceAll(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ""
  );
}

function runStep(label, command, args, options = {}) {
  process.stdout.write(`\n==> ${label}\n`);

  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.error) {
    process.stderr.write(String(result.error));
    process.stderr.write("\n");
    process.exit(1);
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const combined = stripAnsi(`${stdout}\n${stderr}`);
  if (/\bwarning\b/i.test(combined)) {
    process.stderr.write(`\nERROR: Warnings detected during "${label}".\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(`\nERROR: "${label}" failed with exit code ${result.status}.\n`);
    process.exit(result.status ?? 1);
  }
}

function runNpmStep(label, npmArgs, options = {}) {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    runStep(label, process.execPath, [npmExecPath, ...npmArgs], options);
    return;
  }

  const fallbackNpm = process.platform === "win32" ? "npm.cmd" : "npm";
  runStep(label, fallbackNpm, npmArgs, options);
}

function commandExists(command) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "where" : "which", [command], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function isWsl() {
  return (
    process.platform === "linux" &&
    (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME || process.env.WSLENV)
  );
}

function wslIsUsableOnWindowsHost() {
  if (process.platform !== "win32") return false;
  if (!commandExists("wsl.exe")) return false;
  const result = spawnSync("wsl.exe", ["-e", "uname"], { encoding: "utf8" });
  return result.status === 0;
}

function runCaptureSingleLine(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  if (result.status !== 0) return null;
  const out = String(result.stdout ?? "").replaceAll("\r", "").trim();
  return out ? out : null;
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
  const result = spawnSync("wsl.exe", ["-e", "wslpath", "-u", "-a", winPath], { encoding: "utf8" });
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
  const result = spawnSync("wslpath", ["-w", "-a", wslPath], { encoding: "utf8" });
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

function runRustChecksForPlatform(platform, rustRootDir) {
  const rustCargoToml = path.join(process.cwd(), rustRootDir, "Cargo.toml");

  if (platform === "windows") {
    if (process.platform === "win32") {
      runStep("Rust build (Windows, warnings as errors)", "cargo", ["build"], {
        cwd: rustRootDir,
        env: { RUSTFLAGS: "-Dwarnings" },
      });
      runStep("Rust tests (Windows, warnings as errors)", "cargo", ["test"], {
        cwd: rustRootDir,
        env: { RUSTFLAGS: "-Dwarnings" },
      });
      runStep("Rust clippy (Windows, deny warnings)", "cargo", ["clippy", "--", "-D", "warnings"], {
        cwd: rustRootDir,
      });
      return;
    }

    if (process.platform === "linux") {
      if (!isWsl() || !commandExists("cargo.exe")) {
        throw new Error(
          "Windows Rust checks require WSL with access to Windows cargo.exe (install Rust on Windows, ensure cargo.exe is in PATH)."
        );
      }
      const winCargoToml = wslPathToWindowsPath(rustCargoToml);
      const wslenv = appendWslenvToken(process.env.WSLENV, "RUSTFLAGS");

      runStep("Rust build (Windows via cargo.exe, warnings as errors)", "cargo.exe", [
        "build",
        "--manifest-path",
        winCargoToml,
      ], {
        env: { RUSTFLAGS: "-Dwarnings", WSLENV: wslenv },
      });
      runStep("Rust tests (Windows via cargo.exe, warnings as errors)", "cargo.exe", [
        "test",
        "--manifest-path",
        winCargoToml,
      ], {
        env: { RUSTFLAGS: "-Dwarnings", WSLENV: wslenv },
      });
      runStep("Rust clippy (Windows via cargo.exe, deny warnings)", "cargo.exe", [
        "clippy",
        "--manifest-path",
        winCargoToml,
        "--",
        "-D",
        "warnings",
      ]);
      return;
    }

    throw new Error(`Unsupported host for windows rust checks: ${process.platform}`);
  }

  if (platform === "linux") {
    if (process.platform === "linux") {
      const cargo = resolveLocalCargoPath() ?? "cargo";
      runStep("Rust build (Linux, warnings as errors)", cargo, ["build"], {
        cwd: rustRootDir,
        env: { RUSTFLAGS: "-Dwarnings" },
      });
      runStep("Rust tests (Linux, warnings as errors)", cargo, ["test"], {
        cwd: rustRootDir,
        env: { RUSTFLAGS: "-Dwarnings" },
      });
      runStep("Rust clippy (Linux, deny warnings)", cargo, ["clippy", "--", "-D", "warnings"], {
        cwd: rustRootDir,
      });
      return;
    }

    if (process.platform === "win32") {
      if (!wslIsUsableOnWindowsHost()) {
        throw new Error("Linux Rust checks on Windows require WSL (wsl.exe).");
      }

      const wslCargoToml = windowsPathToWslPath(rustCargoToml);
      const wslCargo = resolveWslCargoPathOnWindowsHost();
      if (!wslCargo) {
        throw new Error(
          "Could not resolve a usable WSL cargo. Install rustup inside WSL (recommended) so $HOME/.cargo/bin/cargo exists."
        );
      }
      runStep("Rust build (Linux/WSL, warnings as errors)", "wsl.exe", [
        "-e",
        "env",
        "RUSTFLAGS=-Dwarnings",
        wslCargo,
        "build",
        "--manifest-path",
        wslCargoToml,
      ]);
      runStep("Rust tests (Linux/WSL, warnings as errors)", "wsl.exe", [
        "-e",
        "env",
        "RUSTFLAGS=-Dwarnings",
        wslCargo,
        "test",
        "--manifest-path",
        wslCargoToml,
      ]);
      runStep("Rust clippy (Linux/WSL, deny warnings)", "wsl.exe", [
        "-e",
        wslCargo,
        "clippy",
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

runNpmStep("Frontend build (vue-tsc + vite)", ["run", "build"]);
runNpmStep("Frontend tests (vitest --run)", ["run", "test", "--", "--run"]);

{
  const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(process.cwd(), "tools", "docs-screenshots", "vite.config.screenshots.ts");
  runStep("Docs screenshots build (vite)", process.execPath, [viteBin, "build", "--config", configPath]);
}

const rustRootDir = "src-tauri";
const available = {
  windows:
    process.platform === "win32" ? commandExists("cargo") : isWsl() ? commandExists("cargo.exe") : false,
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
    `ERROR: No Rust platforms available. requested=${requested.join(",")} host=${process.platform}\n`
  );
  process.stderr.write(
    `Hint: On Windows host, ensure WSL is installed (wsl.exe). On Linux host, install cargo; on WSL, install Rust on Windows so cargo.exe is available.\n`
  );
  process.exit(1);
}

if (opts.rustPlatform === "both" && selected.length !== 2) {
  process.stderr.write(
    `ERROR: rust-platform=both requested, but not all platforms are available on this host.\n`
  );
  process.stderr.write(
    `Available: ${selected.join(",") || "(none)"} | Host: ${process.platform} | WSL: ${
      isWsl() ? "yes" : "no"
    }\n`
  );
  process.stderr.write(
    `Hint: On Windows, install/enable WSL. On WSL, install Rust on Windows so cargo.exe is available.\n`
  );
  process.exit(1);
}

for (const platform of selected) {
  runRustChecksForPlatform(platform, rustRootDir);
}
