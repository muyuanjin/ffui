// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readJson = (relativePath: string) => {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  return JSON.parse(raw) as any;
};

describe("tauri withGlobalTauri", () => {
  it("keeps window.__TAURI__ injection disabled by default", () => {
    const tauriConf = readJson("src-tauri/tauri.conf.json");
    expect(tauriConf?.app?.withGlobalTauri).toBe(false);
  });
});
