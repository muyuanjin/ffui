// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readJson = (relativePath: string) => {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  return JSON.parse(raw) as any;
};

const sortedUnique = (items: string[]) => Array.from(new Set(items)).sort();

describe("tauri asset protocol scope", () => {
  it("aligns assetProtocol.scope with opener:allow-open-path (+ ui font formats)", () => {
    const tauriConf = readJson("src-tauri/tauri.conf.json");
    const scope: unknown = tauriConf?.app?.security?.assetProtocol?.scope;

    expect(Array.isArray(scope), "expected app.security.assetProtocol.scope to be an array").toBe(true);
    const scopeList = sortedUnique((scope as any[]).map((entry) => String(entry)));

    expect(scopeList, "assetProtocol.scope must not be a global wildcard").not.toContain("**");
    expect(scopeList, "assetProtocol.scope must not be a global wildcard").not.toContain("*");

    const capabilities = readJson("src-tauri/capabilities/default.json");
    const openerPermission = (capabilities?.permissions ?? []).find(
      (permission: any) => permission?.identifier === "opener:allow-open-path",
    );
    const openerAllow = openerPermission?.allow ?? [];
    const openerPatterns = openerAllow.map((entry: any) => String(entry?.path ?? ""));

    const expected = sortedUnique([
      ...openerPatterns,
      "**/*.[tT][tT][fF]",
      "**/*.[oO][tT][fF]",
    ]);

    expect(scopeList).toEqual(expected);
  });
});

