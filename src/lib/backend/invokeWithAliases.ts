import { invokeCommand, type InvokeCommandPayload } from "./invokeCommand";

export type InvokePayload = InvokeCommandPayload;

// Deprecated: kept to avoid large mechanical changes while migrating callers.
// Emits canonical camelCase-only payloads (no snake_case aliases).
export const invokeWithAliases = invokeCommand;
