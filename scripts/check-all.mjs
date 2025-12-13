#!/usr/bin/env node
import { spawnSync } from "node:child_process";

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

runNpmStep("Frontend build (vue-tsc + vite)", ["run", "build"]);
runNpmStep("Frontend tests (vitest --run)", ["run", "test", "--", "--run"]);

runStep("Rust build (warnings as errors)", "cargo", ["build"], {
  cwd: "src-tauri",
  env: { RUSTFLAGS: "-Dwarnings" },
});
runStep("Rust tests (warnings as errors)", "cargo", ["test"], {
  cwd: "src-tauri",
  env: { RUSTFLAGS: "-Dwarnings" },
});
runStep("Rust clippy (deny warnings)", "cargo", ["clippy", "--", "-D", "warnings"], {
  cwd: "src-tauri",
});
