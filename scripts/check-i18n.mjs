import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Simple TS-to-JS evaluator for our locale files (no TS types, minimal ESM support).
// It supports:
// - export default ...
// - export const ...
// - import default / named from relative locale modules
const LOCALE_MODULE_CACHE = new Map();

function resolveLocaleImport(fromFilePath, spec) {
  const base = path.resolve(path.dirname(fromFilePath), spec);
  const ext = path.extname(base);
  const hasRealExt = ext === ".ts" || ext === ".js" || ext === ".mjs" || ext === ".cjs";
  const candidates = hasRealExt
    ? [base]
    : [base, `${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js")];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`Cannot resolve import '${spec}' from ${fromFilePath}`);
}

function parseImportLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("import ")) return null;
  if (trimmed.startsWith("import type ")) return null;

  // import foo from "./bar";
  let m = trimmed.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*;?\s*$/);
  if (m) return { kind: "default", local: m[1], spec: m[2] };

  // import { a, b as c } from "./bar";
  m = trimmed.match(/^import\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']\s*;?\s*$/);
  if (m) return { kind: "named", bindings: m[1], spec: m[2] };

  // import * as ns from "./bar";
  m = trimmed.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*;?\s*$/);
  if (m) return { kind: "namespace", local: m[1], spec: m[2] };

  return null;
}

function loadTsLocaleModule(filePath) {
  const abs = path.resolve(filePath);
  if (LOCALE_MODULE_CACHE.has(abs)) return LOCALE_MODULE_CACHE.get(abs);

  let code = fs.readFileSync(abs, "utf8");
  // Drop `as const` so the code becomes valid JS.
  code = code.replace(/ as const;/g, ";");

  const imports = [];
  const lines = code.split(/\r?\n/g);
  const kept = [];
  for (const line of lines) {
    const parsed = parseImportLine(line);
    if (parsed) {
      imports.push(parsed);
      continue;
    }
    kept.push(line);
  }
  code = kept.join("\n");

  // Transform exports to a simple "exports.*" object.
  code = code.replace(/\bexport\s+default\s+/g, "exports.default = ");
  code = code.replace(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, "exports.$1 =");

  const exports = {};
  LOCALE_MODULE_CACHE.set(abs, exports);

  const importPrelude = imports
    .map((imp) => {
      if (imp.kind === "default") {
        return `const ${imp.local} = __import(${JSON.stringify(imp.spec)}).default;`;
      }
      if (imp.kind === "namespace") {
        return `const ${imp.local} = __import(${JSON.stringify(imp.spec)});`;
      }
      // named
      const parts = String(imp.bindings)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((b) => {
          const m = b.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (!m) throw new Error(`Unsupported named import binding '${b}' in ${abs}`);
          const imported = m[1];
          const local = m[2] || m[1];
          return `${imported}: ${local}`;
        })
        .join(", ");
      return `const { ${parts} } = __import(${JSON.stringify(imp.spec)});`;
    })
    .join("\n");

  const fn = new Function("__import", "exports", `${importPrelude}\n${code}\n//# sourceURL=${abs.replace(/\\/g, "/")}`);

  const __import = (spec) => {
    const nextPath = resolveLocaleImport(abs, spec);
    return loadTsLocaleModule(nextPath);
  };

  fn(__import, exports);
  return exports;
}

function loadLocale(localeDir) {
  const root = path.resolve(process.cwd());
  const baseDir = path.join(root, "src", "locales", localeDir);
  const result = {};
  /** Keep a reference to the app module so we can mirror the real
   *  `src/locales/<locale>.ts` behaviour where `monitor.*` merges
   *  `other.monitor` and `app.monitor`.
   */
  let appModule = null;

  const modules = ["app", "media", "presetEditor", "queue", "vqResults", "other"];
  for (const name of modules) {
    const file = path.join(baseDir, `${name}.ts`);
    const mod = loadTsLocaleModule(file);
    const obj = mod.default;
    if (!obj) throw new Error(`No default export found in ${file}`);
    if (name === "other") {
      Object.assign(result, obj);
    } else {
      result[name] = obj;
      if (name === "app") {
        appModule = obj;
      }
    }
  }

  // Align with src/locales/en.ts & zh-CN.ts where monitor.* is composed as:
  //   monitor: { ...other.monitor, ...app.monitor }
  if (result.monitor && appModule && appModule.monitor) {
    result.monitor = {
      ...result.monitor,
      ...appModule.monitor,
    };
  }

  return result;
}

function collectKeys(obj, prefix = "", out = new Set()) {
  if (obj == null) return out;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out.add(prefix);
    return out;
  }

  for (const [key, value] of Object.entries(obj)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectKeys(value, nextPrefix, out);
  }

  return out;
}

export function extractTKeysFromContent(content) {
  const keys = new Set();

  // Match:
  //   t("...") / t('...') / t(`...`)
  // Notes:
  // - We intentionally ignore interpolated template literals like `foo.${bar}`
  //   because they are not statically checkable as i18n keys.
  const re = /\bt\(\s*(?:"((?:\\.|[^"\\])+)"|'((?:\\.|[^'\\])+)'|`((?:\\.|[^`\\])+)`)/g;

  let match;
  while ((match = re.exec(content)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];
    const isTemplate = match[3] != null;
    if (isTemplate && value.includes("${")) continue;
    keys.add(value);
  }

  return keys;
}

function getUsedKeys() {
  const keys = new Set();

  const root = path.resolve(process.cwd(), "src");
  const exts = new Set([".ts", ".vue"]);

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!exts.has(ext)) continue;
        if (/\.(spec|test)\.ts$/i.test(entry.name)) continue;

        const content = fs.readFileSync(full, "utf8");
        for (const key of extractTKeysFromContent(content)) {
          keys.add(key);
        }
      }
    }
  }

  walk(root);
  return keys;
}

function main() {
  const used = getUsedKeys();

  const en = loadLocale("en");
  const zh = loadLocale("zh-CN");

  const enKeys = collectKeys(en);
  const zhKeys = collectKeys(zh);

  const missingEn = [];
  const missingZh = [];

  for (const key of used) {
    if (!enKeys.has(key)) {
      missingEn.push(key);
    }
    if (!zhKeys.has(key)) {
      missingZh.push(key);
    }
  }

  console.log("Used keys:", used.size);
  console.log("EN keys:", enKeys.size);
  console.log("ZH-CN keys:", zhKeys.size);

  if (missingEn.length === 0 && missingZh.length === 0) {
    console.log("OK: no missing translations for used keys.");
    return;
  }

  process.exitCode = 1;

  if (missingEn.length > 0) {
    console.log("\\nMissing in EN:");
    for (const k of missingEn.sort()) {
      console.log("  -", k);
    }
  }

  if (missingZh.length > 0) {
    console.log("\\nMissing in zh-CN:");
    for (const k of missingZh.sort()) {
      console.log("  -", k);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
