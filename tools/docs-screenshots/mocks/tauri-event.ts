export type UnlistenFn = () => void;

type Listener<T = unknown> = (event: { payload: T }) => void;

const listeners: Record<string, Set<Listener>> = {};

const registerEmitter = () => {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (typeof w.__FFUI_TAURI_EVENT_EMIT__ === "function") return;

  w.__FFUI_TAURI_EVENT_EMIT__ = (event: string, payload: unknown) => {
    const set = listeners[event];
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        handler({ payload });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[docs-screenshots] tauri-event emit handler failed", e);
      }
    }
  };
};

export const listen = async <T>(event: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn> => {
  registerEmitter();
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(handler as Listener);
  return () => {
    listeners[event]?.delete(handler as Listener);
  };
};
