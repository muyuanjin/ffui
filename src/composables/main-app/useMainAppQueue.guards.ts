import type { Ref } from "vue";

export function guardExclusiveAsyncAction<Kind extends string>(
  inProgress: Ref<Kind | null>,
  kind: Kind,
  action: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (inProgress.value) return;
    inProgress.value = kind;
    try {
      await action();
    } finally {
      inProgress.value = null;
    }
  };
}
