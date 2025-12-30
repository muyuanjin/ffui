import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentScope, onScopeDispose } from "vue";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

type PayloadHandler<T> = (payload: T) => void | Promise<void>;

export type UnsubscribeFn = () => void;

export interface SubscribeTauriEventOptions {
  /**
   * Stable subscriber key within a single event name. When the same key
   * subscribes again, the manager replaces the handler instead of adding a
   * duplicate subscription.
   */
  key?: string;
  /**
   * Optional debug label used in error logs.
   * Defaults to the event name.
   */
  debugLabel?: string;
}

type Entry<T> = {
  unlisten: UnlistenFn | null;
  listenPromise: Promise<UnlistenFn> | null;
  subscribers: Map<string, PayloadHandler<T>>;
};

const entries = new Map<string, Entry<any>>();
let nextAutoKey = 0;

function safeUnlisten(unlisten: UnlistenFn, label: string) {
  try {
    unlisten();
  } catch (error) {
    console.error(`Failed to unlisten (${label})`, error);
  }
}

async function ensureListening<T>(eventName: string, entry: Entry<T>, debugLabel: string) {
  if (entry.unlisten || entry.listenPromise) return;

  entry.listenPromise = listen<T>(eventName, (event) => {
    const handlers = Array.from(entry.subscribers.values());
    for (const handler of handlers) {
      try {
        const result = handler(event.payload);
        if (result && typeof (result as Promise<void>).catch === "function") {
          result.catch((error) => {
            console.error(`Failed to handle async event payload (${debugLabel})`, error);
          });
        }
      } catch (error) {
        console.error(`Failed to handle event payload (${debugLabel})`, error);
      }
    }
  });

  try {
    entry.unlisten = await entry.listenPromise;
  } catch (error) {
    console.error(`Failed to listen for event (${debugLabel})`, error);
    entry.unlisten = null;
  } finally {
    entry.listenPromise = null;
  }

  if (entry.subscribers.size === 0 && entry.unlisten) {
    const unlisten = entry.unlisten;
    entry.unlisten = null;
    safeUnlisten(unlisten, debugLabel);
    entries.delete(eventName);
  }
}

function unsubscribeKey(eventName: string, key: string, debugLabel: string) {
  const entry = entries.get(eventName);
  if (!entry) return;

  entry.subscribers.delete(key);

  if (entry.subscribers.size > 0) return;

  if (entry.unlisten) {
    const unlisten = entry.unlisten;
    entry.unlisten = null;
    safeUnlisten(unlisten, debugLabel);
    entries.delete(eventName);
    return;
  }

  // No active unlisten yet (listenPromise is still inflight). Keep the entry
  // so a future subscriber can reuse the same inflight listen, and let
  // ensureListening() clean up once the promise resolves.
}

export async function subscribeTauriEvent<T>(
  eventName: string,
  handler: PayloadHandler<T>,
  options: SubscribeTauriEventOptions = {},
): Promise<UnsubscribeFn> {
  const key = options.key ?? `auto:${(nextAutoKey += 1)}`;
  const debugLabel = options.debugLabel ?? eventName;

  let entry = entries.get(eventName) as Entry<T> | undefined;
  if (!entry) {
    entry = { unlisten: null, listenPromise: null, subscribers: new Map() };
    entries.set(eventName, entry);
  }

  entry.subscribers.set(key, handler);
  await ensureListening(eventName, entry, debugLabel);

  return () => {
    unsubscribeKey(eventName, key, debugLabel);
  };
}

export function subscribeTauriEventInCurrentScope<T>(
  eventName: string,
  handler: PayloadHandler<T>,
  options: SubscribeTauriEventOptions = {},
) {
  if (!getCurrentScope()) {
    throw new Error("subscribeTauriEventInCurrentScope must be called within an active Vue scope");
  }

  let disposed = false;
  let unsubscribe: UnsubscribeFn | null = null;

  void subscribeTauriEvent<T>(eventName, handler, options).then((fn) => {
    if (disposed) {
      fn();
      return;
    }
    unsubscribe = fn;
  });

  onScopeDispose(() => {
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
  });
}

export function resetTauriSubscriptionsForTests() {
  if (!isTestEnv) return;
  for (const [eventName, entry] of entries.entries()) {
    entry.subscribers.clear();
    if (entry.unlisten) {
      safeUnlisten(entry.unlisten, eventName);
      entry.unlisten = null;
    }
  }
  entries.clear();
}
