import baseConfig from "./vite.config";
import { defineConfig, mergeConfig, type UserConfig, type UserConfigFn } from "vite";

const resolveBaseConfig = async (env: Parameters<UserConfigFn>[0]): Promise<UserConfig> => {
  const base = baseConfig as unknown;
  if (typeof base === "function") {
    return (await (base as UserConfigFn)(env)) as UserConfig;
  }
  return base as UserConfig;
};

export default defineConfig(async (env) => {
  const base = await resolveBaseConfig(env);
  const stamp = `${Date.now()}-${process.pid}`;

  return mergeConfig(base, {
    cacheDir: `.cache/vite-perf-audit-${stamp}`,
    build: {
      outDir: `dist-perf-audit-${stamp}`,
    },
  });
});
