import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.env.FFUI_DEBUG_ALIAS_LOADER) {
  // eslint-disable-next-line no-console
  console.error("[alias-loader] loaded");
}

const resolveFile = (absPath) => {
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".vue"];
  for (const ext of exts) {
    const p = `${absPath}${ext}`;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
    for (const ext of exts) {
      const p = path.join(absPath, `index${ext}`);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const abs = path.join(process.cwd(), "src", rel);
    const resolved = resolveFile(abs);
    if (resolved) {
      const url = pathToFileURL(resolved).toString();
      if (process.env.FFUI_DEBUG_ALIAS_LOADER) {
        // eslint-disable-next-line no-console
        console.error(`[alias-loader] ${specifier} -> ${url}`);
      }
      return { url, shortCircuit: true };
    }
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context?.parentURL?.startsWith("file:")) {
    const parentPath = fileURLToPath(context.parentURL);
    const abs = path.resolve(path.dirname(parentPath), specifier);
    const resolved = resolveFile(abs);
    if (resolved) {
      const url = pathToFileURL(resolved).toString();
      if (process.env.FFUI_DEBUG_ALIAS_LOADER) {
        // eslint-disable-next-line no-console
        console.error(`[alias-loader] ${specifier} (from ${context.parentURL}) -> ${url}`);
      }
      return { url, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
