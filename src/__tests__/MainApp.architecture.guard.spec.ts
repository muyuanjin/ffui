import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("MainApp architecture guard", () => {
  it("keeps MainApp.setup as a thin context entry", () => {
    const setup = read("src/MainApp.setup.ts");

    expect(setup).not.toMatch(/\bas\s+MainAppQueueTabModule\b/);
    expect(setup).not.toMatch(/\b(?:queue|shellDomain|dialogsDomain|settingsDomain|presetsDomain)\.[A-Za-z0-9_$]+\s=/);
    expect(setup).not.toMatch(
      /@\/composables\/main-app\/useMainApp(?:Queue|Presets|Dialogs|Settings|Media|Preview|DnDAndContextMenu|Updater|BatchCompress)\b/,
    );
    expect(setup).toContain("@/composables/main-app/context/useMainAppDomains");
  });

  it("resolves domain hooks through domain-scoped injection", () => {
    const domains = read("src/MainApp.domains.ts");

    expect(domains).toMatch(/InjectionKey<ShellDomain>/);
    expect(domains).toMatch(/InjectionKey<QueueDomain>/);
    expect(domains).not.toMatch(/useMainAppContext\(\)\.(?:shell|dialogs|queue|presetsModule|settings|media|preview)/);
  });
});
