#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn(
  "cargo",
  ["test", "generated_queue_ipc_contracts_match_committed", "--manifest-path", "src-tauri/Cargo.toml"],
  {
    env: {
      ...process.env,
      FFUI_UPDATE_QUEUE_CONTRACTS: "1",
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`cargo exited from signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
