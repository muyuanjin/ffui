#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function commandExists(command) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "where" : "which", [command], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function getStagedFiles() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"], {
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) return [];

  const stdout = result.stdout ?? "";
  return stdout
    .split("\0")
    .map((value) => value.trim())
    .filter(Boolean);
}

function main() {
  const stagedFiles = getStagedFiles();
  const stagedRustFiles = stagedFiles.filter((file) => file.startsWith("src-tauri/") && file.endsWith(".rs"));

  if (stagedRustFiles.length === 0) return;

  if (!commandExists(process.platform === "win32" ? "cargo.exe" : "cargo")) {
    process.stderr.write(
      [
        "ERROR: Rust files are staged but Cargo is not available on PATH.",
        "Install Rust (rustup) and ensure `cargo` is available, then retry the commit.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  run("cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("git", ["add", "--", ...stagedRustFiles]);
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error));
  process.stderr.write("\n");
  process.exit(1);
}
