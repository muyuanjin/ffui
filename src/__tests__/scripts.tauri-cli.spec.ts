import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const runWrapperArgProbe = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const output = execFileSync(process.execPath, ["scripts/tauri-cli.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: "",
      FFUI_TAURI_WRAPPER_PRINT_ARGS_FOR_TEST: "1",
      ...env,
    },
  });

  return JSON.parse(output) as string[];
};

describe("scripts/tauri-cli.mjs", () => {
  it("disables updater artifacts for local bundled builds without a signing private key", () => {
    const args = runWrapperArgProbe(["build"]);

    expect(args).toEqual(["build", "--config", JSON.stringify({ bundle: { createUpdaterArtifacts: false } })]);
  });

  it("preserves updater artifacts when a signing private key is configured", () => {
    expect(runWrapperArgProbe(["build"], { TAURI_SIGNING_PRIVATE_KEY: "private-key" })).toEqual(["build"]);
  });

  it("does not override explicit build configuration or no-bundle builds", () => {
    expect(runWrapperArgProbe(["build", "--config", "tauri.local.conf.json"])).toEqual([
      "build",
      "--config",
      "tauri.local.conf.json",
    ]);
    expect(runWrapperArgProbe(["build", "--no-bundle"])).toEqual(["build", "--no-bundle"]);
  });

  it("does not treat build-like arguments on other commands as bundled builds", () => {
    expect(runWrapperArgProbe(["dev", "--", "build"])).toEqual(["dev", "--", "build"]);
  });
});
