export const convertFileSrc = (path: string): string => path;

export class Resource {
  rid: number;

  constructor(rid: number) {
    this.rid = rid;
  }

  async close(): Promise<void> {
    // no-op (docs screenshot mode)
  }
}

export class Channel<T = unknown> {
  onmessage: ((event: T) => void) | null = null;
}

export const invoke = async <T>(cmd: string, _args?: Record<string, unknown>): Promise<T> => {
  // Allow the updater plugin to be imported without crashing the dev build.
  if (cmd === "plugin:updater|check") return null as T;
  if (cmd.startsWith("plugin:updater|")) return undefined as T;
  throw new Error(`invoke(${JSON.stringify(cmd)}) is not available in docs screenshot mode`);
};
