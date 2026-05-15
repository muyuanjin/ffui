#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const LOCAL_UNSIGNED_UPDATER_CONFIG = JSON.stringify({
  bundle: {
    createUpdaterArtifacts: false,
  },
});

function hasSigningPrivateKey(env) {
  return typeof env.TAURI_SIGNING_PRIVATE_KEY === "string" && env.TAURI_SIGNING_PRIVATE_KEY.trim().length > 0;
}

function hasOption(args, longName, shortName) {
  return args.some(
    (arg) => arg === longName || arg.startsWith(`${longName}=`) || arg === shortName || arg.startsWith(shortName),
  );
}

function isHelpRequest(args) {
  return args.includes("--help") || args.includes("-h");
}

function isBuildCommand(args) {
  return args[0] === "build";
}

export function shouldDisableUpdaterArtifactsForLocalBuild(args, env = process.env) {
  if (!isBuildCommand(args)) return false;
  if (isHelpRequest(args)) return false;
  if (hasSigningPrivateKey(env)) return false;
  if (hasOption(args, "--config", "-c")) return false;
  if (args.includes("--no-bundle")) return false;
  return true;
}

export function resolveTauriCliArgs(args, env = process.env) {
  if (!shouldDisableUpdaterArtifactsForLocalBuild(args, env)) return args;

  return [...args, "--config", LOCAL_UNSIGNED_UPDATER_CONFIG];
}

function run() {
  const inputArgs = process.argv.slice(2);
  const tauriArgs = resolveTauriCliArgs(inputArgs, process.env);

  if (process.env.FFUI_TAURI_WRAPPER_PRINT_ARGS_FOR_TEST === "1") {
    process.stdout.write(`${JSON.stringify(tauriArgs)}\n`);
    return;
  }

  if (tauriArgs.length !== inputArgs.length) {
    process.stderr.write(
      "[ffui] TAURI_SIGNING_PRIVATE_KEY is not set; building without updater signature artifacts.\n",
    );
  }

  const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
  const child = spawn(process.execPath, [tauriCli, ...tauriArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.once("error", (err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });

  child.once("close", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
