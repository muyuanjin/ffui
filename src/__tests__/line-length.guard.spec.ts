import fs from "fs";
import path from "path";
import { describe, it } from "vitest";

const SOURCE_THRESHOLD = 500;
const TEST_THRESHOLD = 2000;
const ALLOWED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"]);
const NOTE =
  "本测试禁止修改或跳过，必须运行，用于防止单个前端源码文件过长：源码文件最多500行；专门测试文件（__tests__ 或 *.spec.* / *.test.*）最多2000行，请通过重构拆分解决。";

const frontendRoot = path.join(process.cwd(), "src");

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip obvious non-source directories if they ever appear under src
      if (["node_modules", "dist", ".git"].includes(entry.name)) return [];
      return collectSourceFiles(fullPath);
    }
    if (!entry.isFile()) return [];
    const ext = path.extname(entry.name);
    return ALLOWED_EXTS.has(ext) ? [fullPath] : [];
  });
}

function isDedicatedTestFile(file: string): boolean {
  const normalized = file.split(path.sep).join("/");
  if (normalized.includes("/__tests__/")) return true;
  return /\.(spec|test)\.[cm]?[jt]sx?$/.test(normalized);
}

describe("line length guard (DO NOT MODIFY/SKIP, MUST RUN)", () => {
  it("fails when any frontend file exceeds its line threshold", () => {
    if (!fs.existsSync(frontendRoot)) {
      throw new Error(`${NOTE} 未找到前端目录: ${frontendRoot}`);
    }

    const files = collectSourceFiles(frontendRoot);
    const overLimit = files
      .map((file) => {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split(/\r?\n/).length;
        const threshold = isDedicatedTestFile(file) ? TEST_THRESHOLD : SOURCE_THRESHOLD;
        return { file, lines, threshold };
      })
      .filter(({ lines, threshold }) => lines > threshold)
      .sort((a, b) => b.lines - a.lines);

    if (overLimit.length > 0) {
      const details = overLimit
        .map(({ file, lines, threshold }) => {
          const relative = path.relative(process.cwd(), file);
          const over = lines - threshold;
          return `${relative}: ${lines} 行（超出 ${over} 行，阈值 ${threshold}）`;
        })
        .join("\n");

      throw new Error(
        `${NOTE}\n以下前端文件需拆分（源码>${SOURCE_THRESHOLD} 行；测试>${TEST_THRESHOLD} 行）：\n${details}`,
      );
    }
  });
});
