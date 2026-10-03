import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const lockCommand = workflow.match(/^\s*lock_version="\$\(node -e "(.+)"\)"$/m)?.[1];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readLockVersion(contents: string): string {
  if (!lockCommand) throw new Error("Release workflow is missing its Cargo.lock version command");
  const directory = mkdtempSync(join(tmpdir(), "ffui-release-version-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "src-tauri"));
  writeFileSync(join(directory, "src-tauri", "Cargo.lock"), contents);
  return execFileSync(process.execPath, ["-e", lockCommand.replace(/\\"/g, '"')], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
}

describe("release workflow Cargo.lock version boundary", () => {
  const currentLock = readFileSync(new URL("../../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const currentVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

  it.each(["\n", "\r\n"])("reads the application version with %j line endings", (newline) => {
    expect(readLockVersion(currentLock.replace(/\r?\n/g, newline))).toBe(currentVersion);
  });

  it("selects ffui rather than a neighboring dependency, including mixed line endings", () => {
    const contents = [
      'version = 4\n\n[[package]]\r\nname = "dependency"\r\nversion = "9.9.9"',
      '\n\n[[package]]\nname = "ffui"\r\nversion = "1.2.3"',
      '\r\n\r\n[[package]]\r\nname = "other"\nversion = "8.8.8"\n',
    ].join("");
    expect(readLockVersion(contents)).toBe("1.2.3");
  });

  it("leaves a missing application version empty so the mismatch gate rejects it", () => {
    expect(readLockVersion('version = 4\r\n\r\n[[package]]\r\nname = "dependency"\r\nversion = "9.9.9"\r\n')).toBe("");
  });

  it("preserves a stale application version instead of substituting the configured version", () => {
    expect(readLockVersion('version = 4\r\n\r\n[[package]]\r\nname = "ffui"\r\nversion = "0.0.1"\r\n')).toBe("0.0.1");
  });
});
