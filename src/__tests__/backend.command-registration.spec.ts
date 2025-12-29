// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readText = (relativePath: string) => {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
};

const uniqSorted = (items: string[]) => Array.from(new Set(items)).sort();

const walkFiles = (rootRelative: string): string[] => {
  const rootAbs = path.join(process.cwd(), rootRelative);
  const out: string[] = [];

  const walk = (dirAbs: string, dirRel: string) => {
    for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const abs = path.join(dirAbs, ent.name);
      const rel = path.join(dirRel, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!rel.endsWith(".ts")) continue;
      if (rel.endsWith(".spec.ts") || rel.endsWith(".test.ts")) continue;
      out.push(rel);
    }
  };

  walk(rootAbs, rootRelative);
  return out;
};

describe("backend invoke commands are registered in Rust", () => {
  it("ensures every invokeCommand() command name exists in src-tauri/src/lib.rs generate_handler list", () => {
    const invoked = uniqSorted(
      walkFiles("src/lib")
        .flatMap((relativePath) => {
          const source = readText(relativePath);
          const invokeMatches = Array.from(source.matchAll(/\binvokeCommand(?:<[^>]*>)?\(\s*["']([a-z0-9_]+)["']/g));
          return invokeMatches.map((m) => m[1]);
        })
        .filter((name): name is string => typeof name === "string" && name.length > 0),
    );

    const rustSource = readText("src-tauri/src/lib.rs");
    const handlerMatch = rustSource.match(/generate_handler!\[\s*([\s\S]*?)\s*\]\)/m);
    expect(handlerMatch, "expected generate_handler![...] in src-tauri/src/lib.rs").toBeTruthy();
    const handlerList = handlerMatch?.[1] ?? "";

    const rustCommandMatches = Array.from(handlerList.matchAll(/::([a-z0-9_]+)\s*(?:,|\s*$)/g));
    const registered = uniqSorted(rustCommandMatches.map((m) => m[1]));

    const missing = invoked.filter((name) => !registered.includes(name));
    expect(missing, `missing Rust command registrations for: ${missing.join(", ")}`).toEqual([]);
  });
});
