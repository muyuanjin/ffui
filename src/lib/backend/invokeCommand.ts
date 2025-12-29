import { invoke } from "@tauri-apps/api/core";

export type InvokeCommandPayload = Record<string, unknown>;

const PROTO_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertCanonicalInvokePayload(payload: InvokeCommandPayload) {
  for (const key of Object.keys(payload)) {
    if (PROTO_POLLUTION_KEYS.has(key)) {
      throw new Error(`invokeCommand payload key is not allowed: ${key}`);
    }
    if (key.includes("_")) {
      throw new Error(`invokeCommand payload keys must be camelCase-only (no snake_case): ${key}`);
    }
  }
}

export async function invokeCommand<T>(command: string, payload?: InvokeCommandPayload): Promise<T> {
  if (payload === undefined) return invoke<T>(command);
  assertCanonicalInvokePayload(payload);
  return invoke<T>(command, payload);
}
