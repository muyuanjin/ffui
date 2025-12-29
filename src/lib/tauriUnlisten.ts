import type { UnlistenFn } from "@tauri-apps/api/event";

export interface UnlistenHandle {
  replace: (next: UnlistenFn | null) => void;
  clear: () => void;
}

export const createUnlistenHandle = (label: string): UnlistenHandle => {
  let current: UnlistenFn | null = null;

  const clear = () => {
    if (!current) return;
    const fn = current;
    current = null;
    try {
      fn();
    } catch (error) {
      console.error(`Failed to unlisten (${label})`, error);
    }
  };

  const replace = (next: UnlistenFn | null) => {
    if (current === next) return;
    clear();
    current = next;
  };

  return { replace, clear };
};
