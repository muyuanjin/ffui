import { invoke } from "@tauri-apps/api/core";

export type InvokePayload = Record<string, unknown>;

const PROTO_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const toSnakeCase = (key: string): string => {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
};

export const addSnakeCaseAliases = (payload: InvokePayload): InvokePayload => {
  const next: InvokePayload = { ...payload };

  for (const key of Object.keys(payload)) {
    if (!/[A-Z]/.test(key)) continue;
    if (PROTO_POLLUTION_KEYS.has(key)) continue;

    const snakeKey = toSnakeCase(key);
    if (snakeKey === key) continue;
    if (snakeKey in next) continue;

    next[snakeKey] = payload[key];
  }

  return next;
};

export const invokeWithAliases = <T>(command: string, payload?: InvokePayload): Promise<T> => {
  if (!payload) {
    return invoke<T>(command);
  }
  return invoke<T>(command, addSnakeCaseAliases(payload));
};
