// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readText = (relativePath: string) => {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
};

const uniqSorted = (items: string[]) => Array.from(new Set(items)).sort();

describe("backend invoke commands are registered in Rust", () => {
  it("ensures every invoke() command name exists in src-tauri/src/lib.rs generate_handler list", () => {
    const backendSource = readText("src/lib/backend.ts");
    const invokeMatches = Array.from(backendSource.matchAll(/\binvoke(?:<[^>]*>)?\(\s*["']([a-z0-9_]+)["']/g));
    const invoked = uniqSorted(invokeMatches.map((m) => m[1]));

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
