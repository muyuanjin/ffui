import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("docs screenshots Vite config", () => {
  it("aliases @tauri-apps/api/window to a docs mock", async () => {
    const configPath = path.join(process.cwd(), "tools", "docs-screenshots", "vite.config.screenshots.ts");
    const source = await readFile(configPath, "utf8");

    expect(source).toContain('find: "@tauri-apps/api/window"');
    expect(source).toContain("mocks/tauri-window");
  });
});
