import fs from "node:fs";
import path from "node:path";

// Simple TS-to-JS evaluator for our locale files.
function evalTsModule(filePath) {
  let code = fs.readFileSync(filePath, "utf8");
  // Drop `as const` so the code becomes valid JS.
  code = code.replace(/ as const;/g, ";");

  const match = code.match(/export default (\w+);?/);
  if (!match) {
    throw new Error(`No default export found in ${filePath}`);
  }

  const exported = match[1];
  code = code.replace(/export default (\w+);?/g, "");
  code += `\nmodule.exports = ${exported};\n`;

  const module = { exports: {} };
  const fn = new Function("module", "exports", code);
  fn(module, module.exports);
  return module.exports;
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

  const modules = ["app", "media", "presetEditor", "queue", "other"];
  for (const name of modules) {
    const file = path.join(baseDir, `${name}.ts`);
    const obj = evalTsModule(file);
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

function getUsedKeys() {
  const keys = new Set();

  const root = path.resolve(process.cwd(), "src");
  const exts = new Set([".ts", ".vue"]);

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!exts.has(ext)) continue;

        const content = fs.readFileSync(full, "utf8");
        const re = /\bt\("([^"]+)"/g;
        let match;
        while ((match = re.exec(content)) !== null) {
          keys.add(match[1]);
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

main();
