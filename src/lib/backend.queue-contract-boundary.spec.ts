import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(process.cwd(), "src");
const GENERATED_IMPORT_RE =
  /from\s+["'][^"']*backend\/generated\/queue-contracts["']|import\s*\([^)]*["'][^"']*backend\/generated\/queue-contracts["'][^)]*\)/;

const allowedImporters = new Set([
  "src/lib/backend.ts",
  "src/lib/backend.queue-startup.ts",
  "src/lib/backend.queue-state.contract.spec.ts",
]);

const isSourceFile = (filePath: string): boolean => /\.(ts|tsx|vue)$/.test(filePath);

const walkSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "generated") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
    } else if (entry.isFile() && isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
};

const toRepoPath = (filePath: string): string => path.relative(process.cwd(), filePath).split(path.sep).join("/");

const canImportGeneratedQueueContracts = (repoPath: string): boolean => {
  if (allowedImporters.has(repoPath)) return true;
  if (/^src\/lib\/backend\/.+\.ts$/.test(repoPath)) return true;
  if (/\.spec\.ts$/.test(repoPath)) return true;
  return false;
};

describe("generated queue contract boundary", () => {
  it("keeps generated Wire types at backend boundaries and contract tests", () => {
    const offenders = walkSourceFiles(SRC_ROOT)
      .map((filePath) => ({ filePath, repoPath: toRepoPath(filePath) }))
      .filter(({ filePath }) => GENERATED_IMPORT_RE.test(fs.readFileSync(filePath, "utf8")))
      .map(({ repoPath }) => repoPath)
      .filter((repoPath) => !canImportGeneratedQueueContracts(repoPath));

    expect(offenders).toEqual([]);
  });
});
