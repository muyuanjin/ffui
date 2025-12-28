import { defineConfig, mergeConfig, type UserConfig, type ConfigEnv } from "vite";
import baseConfigFactory from "../../vite.config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../..");

const resolveFromRepo = (...parts: string[]) => path.resolve(repoRoot, ...parts);

export default defineConfig(async (env: ConfigEnv): Promise<UserConfig> => {
  const base = typeof baseConfigFactory === "function" ? await baseConfigFactory(env) : baseConfigFactory;

  const aliasBackend = resolveFromRepo("tools/docs-screenshots/mocks/backend.ts");
  const aliasI18n = resolveFromRepo("tools/docs-screenshots/mocks/i18n.ts");
  const aliasTauriEvent = resolveFromRepo("tools/docs-screenshots/mocks/tauri-event.ts");
  const aliasTauriCore = resolveFromRepo("tools/docs-screenshots/mocks/tauri-core.ts");
  const aliasTauriApp = resolveFromRepo("tools/docs-screenshots/mocks/tauri-app.ts");
  const aliasTauriWindow = resolveFromRepo("tools/docs-screenshots/mocks/tauri-window.ts");
  const aliasTauriOpener = resolveFromRepo("tools/docs-screenshots/mocks/tauri-opener.ts");

  const _srcMainAbs = resolveFromRepo("src/main.ts");
  const srcDir = resolveFromRepo("src");

  return mergeConfig(base, {
    plugins: [
      {
        name: "ffui-perf-thumb-server",
        configureServer(server) {
          const width = 320;
          const height = 180;
          const rowStride = (width * 3 + 3) & ~3;
          const pixelBytes = rowStride * height;
          const fileSize = 14 + 40 + pixelBytes;
          const bmp = (() => {
            const buf = Buffer.allocUnsafe(fileSize);
            let offset = 0;

            // BITMAPFILEHEADER (14)
            buf.write("BM", offset, "ascii");
            offset += 2;
            buf.writeUInt32LE(fileSize, offset);
            offset += 4;
            buf.writeUInt16LE(0, offset);
            offset += 2;
            buf.writeUInt16LE(0, offset);
            offset += 2;
            buf.writeUInt32LE(54, offset);
            offset += 4;

            // BITMAPINFOHEADER (40)
            buf.writeUInt32LE(40, offset);
            offset += 4;
            buf.writeInt32LE(width, offset);
            offset += 4;
            buf.writeInt32LE(height, offset);
            offset += 4;
            buf.writeUInt16LE(1, offset);
            offset += 2;
            buf.writeUInt16LE(24, offset);
            offset += 2;
            buf.writeUInt32LE(0, offset);
            offset += 4;
            buf.writeUInt32LE(pixelBytes, offset);
            offset += 4;
            buf.writeInt32LE(2835, offset);
            offset += 4;
            buf.writeInt32LE(2835, offset);
            offset += 4;
            buf.writeUInt32LE(0, offset);
            offset += 4;
            buf.writeUInt32LE(0, offset);
            offset += 4;

            // Pixel data (bottom-up), BGR24 with 4-byte row padding.
            for (let y = 0; y < height; y += 1) {
              const yy = height - 1 - y;
              const rowStart = offset + y * rowStride;
              for (let x = 0; x < width; x += 1) {
                const i = rowStart + x * 3;
                const r = (x * 7 + yy * 3) & 0xff;
                const g = (x * 2 + yy * 11) & 0xff;
                const b = (x * 13 + yy * 5) & 0xff;
                buf[i] = b;
                buf[i + 1] = g;
                buf[i + 2] = r;
              }
              for (let p = rowStart + width * 3; p < rowStart + rowStride; p += 1) {
                buf[p] = 0;
              }
            }

            return buf;
          })();

          server.middlewares.use((req, res, next) => {
            const url = req.url ?? "";
            if (!url.startsWith("/__ffui_perf__/thumb.bmp")) return next();
            res.statusCode = 200;
            res.setHeader("Content-Type", "image/bmp");
            res.setHeader("Cache-Control", "no-store");
            res.end(bmp);
          });
        },
      },
      {
        name: "ffui-docs-screenshots-i18n",
        enforce: "pre",
        resolveId(source, importer) {
          // The app imports i18n relatively from src/main.ts ("./i18n").
          // Using a plain alias for "src/i18n.ts" is not reliable across platforms
          // because the alias plugin matches import specifiers, not resolved paths.
          // Intercept that specific import so the initial locale can be driven by
          // the ffuiLocale query param (and avoid Select caching the wrong language).
          if (!importer) return null;
          const normalizedImporter = importer.split("\\").join("/");
          if (!normalizedImporter.endsWith("/src/main.ts")) return null;
          if (source === "./i18n" || source === "./i18n.ts") return aliasI18n;
          return null;
        },
      },
    ],
    resolve: {
      // Use an ordered alias list so our specific replacements win over the
      // generic "@/" alias. This is required for Windows builds where alias
      // iteration order can differ after config merging.
      alias: [
        { find: "@/lib/backend", replacement: aliasBackend },
        { find: "@tauri-apps/api/app", replacement: aliasTauriApp },
        { find: "@tauri-apps/plugin-opener", replacement: aliasTauriOpener },
        { find: "@tauri-apps/api/event", replacement: aliasTauriEvent },
        { find: "@tauri-apps/api/core", replacement: aliasTauriCore },
        { find: "@tauri-apps/api/window", replacement: aliasTauriWindow },
        // Keep the project's canonical "@/" path mapping, but avoid matching
        // scoped packages like "@tauri-apps/*".
        { find: /^@\//, replacement: `${srcDir}/` },
      ],
    },
  } satisfies UserConfig);
});
