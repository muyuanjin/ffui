import { invoke } from "@tauri-apps/api/core";

export type InvokeCommandPayload = Record<string, unknown>;

const PROTO_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertNoProtoPollutionKeysDeep(payload: unknown) {
  const seen = new Set<object>();
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null) continue;

    if (seen.has(current)) continue;
    seen.add(current);

    if (!Array.isArray(current)) {
      const proto = Object.getPrototypeOf(current);
      const isPlainObject = proto === Object.prototype || proto === null;
      if (!isPlainObject) {
        throw new Error("invokeCommand payload must be JSON-like (plain object/array primitives only).");
      }
    }

    for (const key of Object.keys(current)) {
      if (PROTO_POLLUTION_KEYS.has(key)) {
        throw new Error(`invokeCommand payload key is not allowed: ${key}`);
      }
      stack.push((current as Record<string, unknown>)[key]);
    }
  }
}

export function assertCanonicalInvokePayload(payload: InvokeCommandPayload) {
  assertNoProtoPollutionKeysDeep(payload);
  for (const key of Object.keys(payload)) {
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
